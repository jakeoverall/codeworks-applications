(function () {
    function FirebaseAuthStore(firebaseApp) {
        var authStore = new Emitter()

        const authProviders = {
            // 'github': new firebase.auth.GithubAuthProvider(),
            'google': new firebase.auth.GoogleAuthProvider(),
            // 'twitter': new firebase.auth.TwitterAuthProvider(),
            'facebook': new firebase.auth.FacebookAuthProvider()
        }

        authStore.currentUser = firebaseApp.auth().currentUser

        authStore.getCurrentUserId = function () {
            return authStore.currentUser ? authStore.currentUser.uid : null
        }

        authStore.login = function (providerString, credentials) {
            var provider = authProviders[providerString]
            credentials && !provider ? firebase.auth().signInWithEmailAndPassword(credentials.email, credentials.password).catch(errorHandler) : firebaseApp.auth().signInWithPopup(provider).catch(errorHandler)
        }

        authStore.register = function (credentials) {
            firebase.auth().createUserWithEmailAndPassword(credentials.email, credentials.password).catch(errorHandler)
        }

        authStore.logout = function () {
            firebase.auth().signOut().then(function () {
                authStore.currentUser = null
                authStore.CHANGE('USER', null)
            }).catch(errorHandler)
        }

        var errorHandler = function (NOTIFICATION) {
            NOTIFICATION.type = 'error'
            console.log(NOTIFICATION)
            authStore.CHANGE('NOTIFICATION', NOTIFICATION)
        }

        firebaseApp.auth().onAuthStateChanged(function (user) {
            authStateChanged(user)
        })

        var onAuthStateChanged = function (Object, optError, optCompleted) {
            return authStore.firebaseApp.auth().onAuthStateChanged(nextOrObserver, optError, optCompleted)
        }

        var authStateChanged = function (user) {
            if ((user && authStore.currentUserId === user.uid) || (!user && !authStore.currentUserId)) {
                return
            }
            authStore.CHANGE('USER', user)
            authStore.currentUser = user
            if (user) {
                writeUserData(user.uid, user.displayName, user.email, user.photoURL)
            }
        }

        var writeUserData = function (userId, displayName, email, photoURL) {
            firebase.database().ref('users/' + userId).set({
                id: userId,
                displayName: displayName,
                email: email,
                photoURL: photoURL
            })
        }
        return authStore
    }

    function Emitter() {
        this.listeners = {}
    }

    Emitter.prototype.on = function (message, callback) {
        this.listeners[message] = this.listeners[message] || []
        this.listeners[message].push(callback)
    }

    Emitter.prototype.off = function (message, callback) {
        if (!this.listeners[message]) { return }
        var i = this.listeners[message].indexOf(callback)
        this.listeners[message].splice(i, 1)
    }

    Emitter.prototype.CHANGE = function (message, payload) {
        this.emit(message, payload)
    }

    Emitter.prototype.emit = function (message, payload) {
        for (var f in this.listeners[message]) {
            if (typeof this.listeners[message][f] == 'function') {
                this.listeners[message][f](payload)
            }
        }
    }

    function Store(config) {
        var store = this

        //Store inherits Event Emitter Methods
        store = Object.create(new Emitter())

        var state = config.state || {}
        var mutations = config.mutations || {}
        store.actions = config.actions || {}
        store.getter = config.getters || {}

        store.getState = function () {
            // Allows DEEP copy of state
            return JSON.parse(JSON.stringify(state))
        }

        function _toArray(type) {
            if (typeof type == 'string') {
                type = [type]
            }
            if (!Array.isArray(type)) {
                return console.error(`[store::dispatch] expecting a string or array of strings but got: `, type)
            }
            return type
        }

        store.dispatch = function (type, payload) {
            type = _toArray(type)
            dispatchableActions = type.filter(function (name) {
                var action = store.actions[type]
                return action ? action : console.error(`[store::dispatch] unknown action type ${action}`)
            })
            dispatchableActions.map(function (action) {
                store.actions[action](payload)
            })
        }

        store.commit = function (name, payload) {
            var commitable = mutations[name]
            if (!commitable) {
                return console.error(`[store::commit] unknown mutation type ${name}`)
            }
            commitable = commitable.bind(null)
            state = commitable(state, payload)
            store.CHANGE(name, payload)
        }
        return store
    }


    // Initialize Firebase
    var config = {
        apiKey: "AIzaSyBhH2koK2o_MBNrF9qWWSqm4A-XjjmWoJw",
        authDomain: "codeworks-cb2cf.firebaseapp.com",
        databaseURL: "https://codeworks-cb2cf.firebaseio.com",
    };
    var firebaseApp = firebase.initializeApp(config)
    var authStore = new FirebaseAuthStore(firebaseApp);
    var store = new Store({
        state: {
            account: {
                uid: '',
                email: ''
            },
            user: {},
            application: {}
        },
        mutations: {
            setAccount: function (state, account) {
                account = account || {}
                state.account = { email: account.email, id: account.uid }
                return state
            },
            setApplication(state, application) {
                state.application = application
                return state
            }
        },
        actions: {
            COMPLETE_APPLICATION: function (application) {
                var account = authStore.currentUser
                if (!account) { return }
                application.step = 2
                saveApplication(account.uid, application, function () {
                    store.commit('setApplication', application)
                })
                saveToOld(application, function () {

                })
            },
            EDIT_APPLICATION: function (application) {
                var account = authStore.currentUser
                if (!account) { return }
                application.step = 1
                application.edited = true
                saveApplication(account.uid, application, function () {
                    store.commit('setApplication', application)
                })
            }
        }
    })


    function fetchApplication(accountId, cb) {
        if (!accountId) { return cb({ error: 'No User Id Found' }) }
        var appRef = firebaseApp.database().ref('applications').child(accountId)
        appRef.once('value', function (snapshot) {
            cb(snapshot.val())
        }, (err) => {
            console.log(err)
            cb()
        })
    }

    function saveApplication(accountId, application, cb) {
        var appRef = firebaseApp.database().ref('applications').child(accountId)
        appRef.set(application).then(function () { if (typeof cb == 'function') { cb() } })
    }

    function saveToOld(app, cb) {
        if (app.edited) { return }
        $.post('https://bcw-getter.herokuapp.com/slacker', { app: app }, function (res) {
            console.log(res)
            if (typeof cb == 'function') {
                cb()
            }
        })
    }

    authStore.on('USER', function (user) {
        store.commit('setAccount', user)
        if (!user) { return }
        fetchApplication(user.uid, function (application) {
            application = application || {}
            var defaults = defaultApp(user)
            for (var key in defaults) {
                if (!application[key]) {
                    application[key] = defaults[key]
                }
            }
            store.commit('setApplication', application)
        })
    })


    var signupForm = new Vue({
        el: '#signup',
        data: {
            showEmail: false,
            activeView: 'next-steps',
            app: {
                uid: '',
                step: 0,
                firstName: '',
                lastName: '',
                email: '',
                phone: '',
                courses: [],
                channel: '',
                otherChannel: '',
                about: '',
                goals: '',
                scholarship: '',
                questions: ''
            },
            assessment: {
                "questions": [
                    {
                        "id": 0,
                        "info": "Tom is taller than Jane who is shorter than Frank who is taller than Bob who is taller than Tom, but shorter than Frank.",
                        "question": "List these names in order of Tallest to Shortest.",
                        "answers": [
                            {
                                "answer": "Tom, Frank, Jane, Bob",
                                "score": 0
                            },
                            {
                                "answer": "Bob, Tom, Frank, Jane",
                                "score": 0
                            },
                            {
                                "answer": "Tom, Bob, Jane, Frank",
                                "score": 0
                            },
                            {
                                "answer": "Frank, Bob, Tom, Jane",
                                "score": 10
                            }
                        ]
                    },
                    {
                        "id": 1,
                        "info": "There is a bus with 6 children on it, each child has 2 bags, each bag has 3 cats, each cat has 4 paws.",
                        "question": "How many total paws would there be on the bus if one child left one of his bags at home?",
                        "answers": [
                            {
                                "answer": "142",
                                "score": 0
                            },
                            {
                                "answer": "132",
                                "score": 10
                            },
                            {
                                "answer": "124",
                                "score": 0
                            },
                            {
                                "answer": "116",
                                "score": 0
                            }
                        ]
                    },
                    {
                        "id": 2,
                        "info": "A train is traveling 90km/hr. If it takes the train a total of 36 seconds to speed past the platform. Remember the entire length of the train passes the platform.",
                        "question": "what is the length of the platform in meters?",
                        "answers": [
                            {
                                "answer": "300",
                                "score": 0
                            },
                            {
                                "answer": "800",
                                "score": 0
                            },
                            {
                                "answer": "600",
                                "score": 10
                            },
                            {
                                "answer": "480",
                                "score": 0
                            }
                        ]
                    },
                    {
                        "id": 3,
                        "info": "Given the function Æ’(x) = x + 5",
                        "question": "What is the value of Æ’(10)?",
                        "answers": [
                            {
                                "answer": "10",
                                "score": 0
                            },
                            {
                                "answer": "15",
                                "score": 10
                            },
                            {
                                "answer": "30",
                                "score": 0
                            },
                            {
                                "answer": "50",
                                "score": 0
                            }
                        ]

                    },
                    {
                        "id": 4,
                        "info": "Understanding loops is a necessary skill for all developers to master. <pre><code>var i = 0;<br/>while(i < 100){<br/>&nbsp;&nbsp;console.log(i);<br/>&nbsp;&nbsp;i = i+1;<br/>}</code></pre>",
                        "question": "Given the code above. When the loop runs, what will occur?",
                        "answers": [
                            {
                                "answer": "The number 0 will be logged to the console 100 times",
                                "score": 0
                            },
                            {
                                "answer": "Nothing will occur, this is bad code",
                                "score": 0
                            },
                            {
                                "answer": "The numbers 0 - 99 will be logged to the console",
                                "score": 10
                            },
                            {
                                "answer": "This will return the number 100",
                                "score": 0
                            }
                        ]
                    },
                    {
                        "id": 5,
                        "info": "Understanding loops is a necessary skill for all developers to master. <pre><code>for(var i=50; i < 100; i++){<br/>&nbsp;&nbsp;console.log(i);<br/>}</code></pre>",
                        "question": "Given the code above. How many times will this loop execute?",
                        "answers": [
                            {
                                "answer": "50 times",
                                "score": 10
                            },
                            {
                                "answer": "100 times",
                                "score": 0
                            },
                            {
                                "answer": "150 times",
                                "score": 0
                            },
                            {
                                "answer": "49 times",
                                "score": 0
                            }
                        ]
                    },
                    {
                        "id": 6,
                        "info": "Given the function Æ’(x) = x + 3",
                        "question": "What is the value of Æ’(5) + Æ’(8)?",
                        "answers": [
                            {
                                "answer": "13",
                                "score": 0
                            },
                            {
                                "answer": "19",
                                "score": 10
                            },
                            {
                                "answer": "40",
                                "score": 0
                            },
                            {
                                "answer": "128",
                                "score": 0
                            }
                        ]
                    },
                    {
                        "id": 7,
                        "info": "Given the function Æ’(x) = x + 3 and g(x) = x * 2",
                        "question": "What is the value of g(Æ’(5))?",
                        "answers": [
                            {
                                "answer": "24",
                                "score": 0
                            },
                            {
                                "answer": "16",
                                "score": 10
                            },
                            {
                                "answer": "18",
                                "score": 0
                            },
                            {
                                "answer": "28",
                                "score": 0
                            }
                        ]
                    },
                    {
                        "id": 8,
                        "info": "A core principle of programming is understanding and using variables. A variable is a value that can change, depending on conditions or on information passed to the program.",
                        "question": "<pre><code>var x = 10;<br/>var y = 3;</code></pre><br/> Which of the following conditions below will <b>**not**</b> result in the value of x being redefined to equal to 16?",
                        "answers": [
                            {
                                "answer": "x = x + 6",
                                "score": 0
                            },
                            {
                                "answer": "x = x + x",
                                "score": 10
                            },
                            {
                                "answer": "x = x + y + y",
                                "score": 0
                            },
                            {
                                "answer": "x = 16",
                                "score": 0
                            }
                        ]
                    },
                    {
                        "id": 10,
                        "info": "HTML utilizes tags or elements to build documents for the the web.",
                        "question": "What is the purpose of the following tag?<p><b>&lt;ul&gt;</b></p>",
                        "answers": [
                            {
                                "answer": "Ordered List",
                                "score": 0
                            },
                            {
                                "answer": "Paragraph",
                                "score": 0
                            },
                            {
                                "answer": "Container",
                                "score": 0
                            },
                            {
                                "answer": "Unordered List",
                                "score": 10
                            }
                        ]
                    },
                    {
                        "id": 11,
                        "info": "HTML utilizes tags or elements to build documents for the the web.",
                        "question": "What is the purpose of the following tag?<p> <b>&lt;div&gt;</b></p>",
                        "answers": [
                            {
                                "answer": "Ordered List",
                                "score": 0
                            },
                            {
                                "answer": "Paragraph",
                                "score": 0
                            },
                            {
                                "answer": "Container",
                                "score": 10
                            },
                            {
                                "answer": "Unordered List",
                                "score": 0
                            }
                        ]
                    },
                    {
                        "id": 12,
                        "info": "CSS is used to make the DOM pretty. CSS targets HTML Elements through the use of selectors.",
                        "question": "Using a \".\" followed by a name is classified as what type of css selector? <i>\"example .box\"</i>",
                        "answers": [
                            {
                                "answer": "ID Selector",
                                "score": 0
                            },
                            {
                                "answer": "Class Selector",
                                "score": 10
                            },
                            {
                                "answer": "Psudo Selector",
                                "score": 0
                            },
                            {
                                "answer": "Element Selector",
                                "score": 0
                            }
                        ]
                    },
                    {
                        "id": 13,
                        "info": "Understanding loops is a necessary skill for all developers to master.<br><pre><code>for(var i = 0; i < 10; i++){<br>  alert('The value of i is now' + i)<br>}</code></pre>",
                        "question": "Which of the following is <b>not</b> true",
                        "answers": [
                            {
                                "answer": "The third value of i is 3",
                                "score": 10
                            },
                            {
                                "answer": "The max value of i will be 10",
                                "score": 0
                            },
                            {
                                "answer": "The final value alerted as i will be 9",
                                "score": 0
                            },
                            {
                                "answer": "The first value of i alerted is 0",
                                "score": 0
                            }
                        ]
                    },
                    {
                        "id": 14,
                        "info": "<pre><code>x = 5<br>y=x*2<br>z=x*y</code></pre>",
                        "question": "Given the code above what is the value of z?",
                        "answers": [
                            {
                                "answer": "50",
                                "score": 10
                            },
                            {
                                "answer": "5",
                                "score": 0
                            },
                            {
                                "answer": "10",
                                "score": 0
                            },
                            {
                                "answer": "100",
                                "score": 0
                            }
                        ]
                    }
                ],
                "results": [
                    {
                        "title": "Sorry you did not pass this time",
                        "description": "Keep Practicing, There are a lot of free resources out there to study from. We highly recommend you start with Khan Academy's Html & CSS and JavaScript Courses. Our main goal at BoiseCodeWorks is to ensure you have an excellent time studying and learning to become a developer, however we do want our students starting knowledge level to bit a bit higher. <br/> This does not disqualify you from the course. You are free to study and try the assessment again. Once you pass we will call you in for a face to face interview to answer any of your remaining questions and to go through a short technical interview. <br/> Good Luck and keep trying. <br/> BCW-Admissions Team",
                        "image": "https://boisecodeworks.com/assets/img/logos/boisecodeworks-logo-lg.png",
                        "minScore": 0
                    },
                    {
                        "title": "Congratulations, You Passed",
                        "description": "You are on the right track for starting a class at BoiseCodeWorks. We are excited to have you as a student and look forward to having you in class. The next steps are to schedule your technical interview and get you started on the precourse work. We have designed our precourse work to be challenging and fun. By the time you complete the precourse work you will be ready to start class. We take completing the precourse work very seriously and will not allow students who have not completed it to participate in the course.",
                        "image": "https://boisecodeworks.com/assets/img/logos/boisecodeworks-logo-lg.png",
                        "minScore": 70
                    }
                ]
            },
            test: {},
            channel: '',
            discoveryChannels: [
                'Online Search',
                'Facebook',
                'Twitter',
                'College Fair',
                'Referral - Friend',
                'Referral - Family',
                'Referral - Graduate',
                'Radio Ad',
                'Meetup'
            ],
            notifications: []
        },
        mounted() {
            store.on('setApplication', setApp.bind(this))
            authStore.on('NOTIFICATION', setNotification.bind(this))
        },
        destroyed() {
            store.off('setApplication', setApp)
        },
        methods: {
            submit(e) {
                store.dispatch('COMPLETE_APPLICATION', this.app)
            },
            login(provider, credentials) {
                authStore.login(provider, credentials || this.app)
            },
            edit() {
                this.app.step = 1;
                store.dispatch('EDIT_APPLICATION', this.app)
            },
            begin() {
                authStore.register(this.app)
            },
            logout() {
                this.app = defaultApp()
                this.app.name = ''
                authStore.logout()
            },
            clear(notification) {
                var i = this.notifications.indexOf(notification)
                if (i != -1) {
                    this.notifications.splice(i, 1)
                }
            }
        }
    })
    function defaultApp(user) {
        user = user || {}
        return {
            uid: user.uid || '',
            email: user.email,
            name: user.displayName || "it's nice to meet you",
            step: user.email ? 1 : 0,
            phone: '',
            courses: [],
            channel: '',
            otherChannel: '',
            about: '',
            goals: '',
            scholarship: '',
            questions: ''
        }
    }
    function setApp(application) {
        this.app = application
    }
    function setNotification(notification) {
        this.notifications.push(notification)
        setTimeout(() => {
            var i = this.notifications.indexOf(notification)
            if (i != -1) {
                this.notifications.splice(i, 1)
            }
        }, 3500)
    }
}())