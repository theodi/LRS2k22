// index.js

/*  EXPRESS */

const express = require('express');
const app = express();
const session = require('express-session');
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
const GOOGLE_CLIENT_ID = '990814127750-b8ltv2lo6d2d0303drqdhpn3mi9599d1.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: "http://localhost:3080/auth/google/callback"
  },
  function(accessToken, refreshToken, profile, done) {
      userProfile=profile;
      return done(null, userProfile);
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

/* Require user to be logged in */

app.get('/profile', function(req, res) {
  if (!userProfile) {
    sitedata.user = null;
    sitedata.page.title = "401 Unauthorised";
    return res.status(401).render("errors/401", {
      data: sitedata
    });
  }
  sitedata.user = userProfile;
  sitedata.page.title = "Profile page";
  res.render('pages/profile', {
    data: sitedata
  })
});

app.get('/page2', function(req, res) {
  if (!userProfile) {
    sitedata.user = null;
    sitedata.page.title = "401 Unauthorised";
    return res.status(401).render("errors/401", {
      data: sitedata
    });
  }
  sitedata.user = userProfile;
  sitedata.page.title = "Page 2";
  res.render('pages/page2', {
    data: sitedata
  })
});

//Keep this at the END!

app.get('*', function(req, res){
  sitedata.page.title = "404 Not Found";
  return res.status(404).render("errors/404", {
    data: sitedata
  });
});

/* Run server */

const port = process.env.PORT || 3080;
app.listen(port , () => console.log('App listening on port ' + port));
