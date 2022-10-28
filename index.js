//Loads the config fomr config.env to process.env (turn off prior to deployment)
require("dotenv").config({ path: "./config.env" });
// index.js

/*  EXPRESS */

const express = require('express');
const cors = require("cors");
const dbo = require("./db/conn");
const app = express();
const session = require('express-session');
var api = require('./api');
var adaptapi = require('./adaptHandler');
var userHandler = require('./userHandler');
const adaptdb = require("./db/adapt-aat");

module.exports = app;

var sitedata = {};
sitedata.user = null;
sitedata.page = {};
sitedata.page.title = "ODI Template (NodeJS + Express + OAuth)";
app.set('view engine', 'ejs');

app.use(session({
  resave: false,
  saveUninitialized: true,
  secret: 'SECRET' 
}));

app.use(express.static(__dirname + '/public'));

app.use(cors());

app.use(express.json());

app.get('/', function(req, res) {
  if (userProfile) {
    res.redirect("/profile");
  } else {
    sitedata.page.title = "ODI Template (NodeJS + Express + OAuth)";
    res.render('pages/auth', {
      data: sitedata
    });
  }
});

/*  PASSPORT SETUP  */

const passport = require('passport');
var userProfile;

app.use(passport.initialize());
app.use(passport.session());

app.set('view engine', 'ejs');

app.post('/logout', function(req, res, next){
  req.logout(function(err) {
    if (err) { return next(err); }
    sitedata.user = null;
    userProfile = null;
    user = null;
    res.redirect('/');
  });
});

app.get('/error', (req, res) => res.send("error logging in"));

passport.serializeUser(function(user, cb) {
  cb(null, user);
});

passport.deserializeUser(function(obj, cb) {
  cb(null, obj);
});

/*  Google AUTH  */
 
const GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: "http://localhost:3080/auth/google/callback"
  },
  function(accessToken, refreshToken, profile, done, req, res) {
    /* No idea what I'm doing here */
      userProfile=profile;
      email = profile.emails[0].value;
      var dbConnect = dbo.getDb();
      dbConnect
        .collection("Users")
        .find({'emails.0.value': email})
        .toArray(function(err,items) {
          if (items.length < 1) {
            userHandler.insertUser(dbo,profile);
            return done(null, userProfile);
          } else if (items[0].suspended) {
            sitedata.user = null;
            userProfile = null;
            user = null;
            return done(null, null);
          } else {
            userHandler.updateLastLoginTime(dbo,email);
            userProfile = items[0];
            return done(null, userProfile);
          }
        });
  }
));
 
app.get('/auth/google', 
  passport.authenticate('google', { scope : ['profile', 'email'] }));
 
app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/error' }),
  function(req, res) {
    // Successful authentication, redirect success.
    res.redirect('/profile');
  });

/* Define all the pages */

/* Do not require login */

app.get('/page1', function(req, res) {
  sitedata.user = userProfile;
  sitedata.page.title = "Page 1";
  res.render('pages/page1', {
    data: sitedata
  })
});

/*
 * e.g. /questionSummary?activity=https://learning.theodi.org/xapi/activities/mit-moral-machine-test#/id/630f81656b4097008b2afd6f_branching_0
 * e.g. https://theodi.stream.org/xapi/activities/learning-lockker-stand-alone-xapi-test-dt%23/id/5fd8d72191349e0067628eb3
 */
app.get('/questionSummary', function(req, res) {
  console.log("Question summary");
  sitedata.user = userProfile;
  sitedata.page.title = "Question insights";
  sitedata.activity = encodeURIComponent(req.query.activity);
  res.render('pages/questionSummary', {
    data: sitedata
  })
});

/* Require user to be logged in */

function unauthorised(res) {
  sitedata.user = null;
  sitedata.page.title = "401 Unauthorised";
  return res.status(401).render("errors/401", {
    data: sitedata
  });
}

app.get('/profile', function(req, res) {
  if (!userProfile) { unauthorised(res); return; }
  sitedata.user = userProfile;
  sitedata.page.title = "Profile page";
  res.render('pages/profile', {
    data: sitedata
  })
});

app.get('/courses', function(req, res) {
  if (!userProfile) { unauthorised(res); return; }

  sitedata.user = userProfile;
  sitedata.page.title = "Courses";
  var dbConnectAAT = adaptdb.getDb();
  dbConnectAAT
    .collection("courses")
    .find({})
      .toArray(function(err,items) {
        res.render('pages/courses', {
          data: sitedata,
          courses: items
        })
      });
});

app.get('/course/:id', function(req, res) {
  if (!userProfile) { unauthorised(res); return; }
  sitedata.user = userProfile;
  sitedata.page.title = "Course" + req.params.id;
  res.render('pages/contentObject', {
    data: sitedata,
    id: req.params.id
  });
});

/* API requests private methods */ 

app.get('/api/activityData', function (req, res) {
  if (!userProfile) { unauthorised(res); return; }
  api.getActivityData(req, res); 
});

/* The complete adapt API */

/**
 * api/courses
 * List all courses
 */ 
app.get('/api/courses', function(req,res) {
  if (!userProfile && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  adaptapi.getObjectsFromCollection(req, res, adaptdb, "courses");
});

app.get('/api/courseDetail', function(req,res) {
  if (!userProfile && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  adaptapi.getCourses(req, res, dbo);
});

app.get('/api/contentObject/', function(req,res) {
  if (!userProfile && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  adaptapi.getContentObject(req, res, dbo);
});

/*
 * API requests, public methods 
 */
app.get('/api/questionSummary', function (req, res) {
  api.getQuestionSummaryData(req, res); 
});

/**
 * api/collection
 * Get all items in a collection for a specific parentId
 * e.g. api/contentobjects/?parentId=xxxxxx
 * e.g. api/blocks/?parentId=xxxxxx
 */
app.get('/api/:collection/', function(req,res) {
  if (!userProfile && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  if (req.query.parentId) {
    adaptapi.findObjectsWithParentId(req, res, adaptdb, req.params.collection, req.query.parentId);
  } else {
    return res.status(400).render("errors/400", {
      data: sitedata
    });
  }
});

/**
 * api/collection/:id
 * Get data for a single item e.g. article, course, block, component
 * e.g. api/contentobject/xxxxxx
 * e.g. api/block/xxxxxx
 */
app.get('/api/:collection/:id', function(req,res) {
  if (!userProfile && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  adaptapi.getObjectById(req, res, adaptdb, req.params.collection, req.params.id);
});

//Keep this at the END!

app.get('*', function(req, res){
  sitedata.page.title = "404 Not Found";
  return res.status(404).render("errors/404", {
    data: sitedata
  });
});

adaptdb.connectToServer(function (err) {
  if(err) {
    console.log(err);
  }
});

setTimeout(() => {
  adaptapi.updateCourseCache(adaptdb,dbo);
},2000);

setInterval(() => {
  adaptapi.updateCourseCache(adaptdb,dbo);
},1800000);

/* Run server */

// perform a database connection when the server starts
dbo.connectToServer(function (err) {
  if (err) {
    console.error(err);
    process.exit();
  }

  const port = process.env.PORT || 3080;
  // start the Express server
  app.listen(port, () => {
    console.log(`Server is running on port: ${port}`);
  });
});