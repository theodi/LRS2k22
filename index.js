//Loads the config fomr config.env to process.env (turn off prior to deployment)
require("dotenv").config({ path: "./config.env" });
// index.js

/*  EXPRESS */

const express = require('express');
const cors = require("cors");
const http = require('http');
const https = require('https');
const fs = require('fs-extra');
const dbo = require("./db/conn");
const tmp = require('tmp-promise');
const tar = require('tar');
const path = require('path');
const rimraf = require('rimraf');
const { ObjectId } = require("mongodb");
const session = require('express-session');
var api = require('./api');
var adaptapi = require('./adaptHandler');
var userHandler = require('./userHandler');
const xmlToHtml = require("./xml-to-html");
const adaptdb = require("./db/adapt-aat");
const aatBase = process.env.AAT_BASE;
const multer = require('multer');
const fetch = require('node-fetch');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './uploads'); // Set the destination directory for uploaded files
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname); // Set the filename for uploaded files
  },
});
const upload = multer({ storage });

if (process.env.SSLKEY) {
  var privateKey  = fs.readFileSync(process.env.SSLKEY, 'utf8');
  var certificate = fs.readFileSync(process.env.SSLCERT, 'utf8');
  var credentials = {key: privateKey, cert: certificate};
}

const app = express();
app.use(express.urlencoded());

module.exports = app;

app.set('view engine', 'ejs');

app.use(session({
  resave: false,
  saveUninitialized: true,
  secret: 'SECRET'
}));

//Put the user object in a global veriable so it can be accessed from templates
app.use(function(req, res, next) {
  try {
    res.locals.user = req.session.passport.user;
    next();
  } catch (error) {
    res.locals.user = req.session.user;
    next();
  }
});

app.use(express.static(__dirname + '/public'));

app.use(cors());

app.use(express.json());

app.get('/', function(req, res) {
  if (req.session.passport) {
    res.redirect("/profile");
  } else {
    res.locals.pageTitle ="ODI Template (NodeJS + Express + OAuth)";
    res.render('pages/auth');
  }
});

/*  PASSPORT SETUP  */

const passport = require('passport');

app.use(passport.initialize());
app.use(passport.session());

app.set('view engine', 'ejs');

app.post('/logout', function(req, res, next){
  req.logout(function(err) {
    if (err) { return next(err); }
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
const CALLBACK_URL = "//"+process.env.HOST+"/auth/google/callback"

passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: CALLBACK_URL
  },
  function(accessToken, refreshToken, profile, done, req, res) {
    /* No idea what I'm doing here */
      email = profile.emails[0].value;
      var dbConnect = dbo.getDb();
      dbConnect
        .collection("Users")
        .find({'emails.0.value': email})
        .toArray(function(err,items) {
          if (items.length < 1) {
            userHandler.insertUser(res,dbo,profile);
            return done(null, profile);
          } else if (items[0].suspended.toString() == "true") {
            return done(null, null);
          } else {
            userHandler.updateLastLoginTime(res,dbo,email);
            return done(null, profile);
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

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated())
    return next();
  else
    unauthorised(res);
}

app.use('/private', ensureAuthenticated);
app.use('/private', express.static(__dirname + '/private'));

/* Define all the pages */

/* Do not require login */

app.get('/page1', function(req, res) {
  res.locals.pageTitle = "Page 1";
  res.render('pages/page1');
});

/*
 * e.g. /questionSummary?activity=https://learning.theodi.org/xapi/activities/mit-moral-machine-test#/id/630f81656b4097008b2afd6f_branching_0
 * e.g. https://theodi.stream.org/xapi/activities/learning-lockker-stand-alone-xapi-test-dt%23/id/5fd8d72191349e0067628eb3
 */
app.get('/questionSummary', function(req, res) {
  res.locals.pageTitle = "Question insights";
  res.locals.activity = encodeURIComponent(req.query.activity);
  res.render('pages/questionSummary');
});

app.post('/interactions', express.json(), async function(req, res){
  // Extract relevant data from the request body
  const { studentId, _component, _componentId, _userAnswer, _userFeedback } = req.body;
  // Check if the required fields are present in the request body
  if (!_userAnswer || !_userFeedback || !_component || !studentId || !_componentId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const timestamp = new Date().getTime();

  try {
    var dbConnect = dbo.getDb();

    const newInteraction = {
      studentId,
      timestamp,
      _component,
      _componentId,
      _userAnswer,
      _userFeedback
    };

    const interactionsCollection = dbConnect.collection('Interactions');
    // Insert the new interaction into the "Interactions" collection
    const result = await interactionsCollection.insertOne(newInteraction);

    // Return the ID of the created object to the user
    res.status(201).json({ id: result.insertedId });
  } catch (err) {
    // Handle any errors that occur during the database operation
    console.error('Error saving interaction:', err);
    res.status(500).json({ error: 'Error saving interaction' });
  }
});

app.post('/userAnswer', express.json(), async function(req, res) {
  // Extract relevant data from the request body
  const { componentID, componentType, userAnswer, items } = req.body;

  // Check if the required fields are present in the request body
  if (!componentID || !componentType || !userAnswer || !items) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const timestamp = new Date().getTime();

  try {
    // Assuming you have a database connection similar to 'dbo.getDb()'
    var dbConnect = dbo.getDb();

    const newUserAnswer = {
      timestamp,
      componentID,
      componentType,
      userAnswer,
      items,
    };

    const transmitterDataCollection = dbConnect.collection('TransmitterData');

    // Insert the new userAnswer into the "TransmitterData" collection
    const result = await transmitterDataCollection.insertOne(newUserAnswer);

    // Return the ID of the created object to the user
    res.status(201).json({ id: result.insertedId });
  } catch (err) {
    // Handle any errors that occur during the database operation
    console.error('Error saving userAnswer:', err);
    res.status(500).json({ error: 'Error saving userAnswer' });
  }
});

async function fetchAnswerSummary(componentID) {
  try {
    var dbConnect = dbo.getDb();

    // Find all documents with the specified componentID
    const cursor = dbConnect.collection('TransmitterData').find({ componentID });

    // Initialize an array to store the collated userAnswers
    let collatedAnswers = [];

    // Iterate through the documents and collate userAnswers
    await cursor.forEach(doc => {
      const userAnswer = doc.userAnswer;

      // Ensure that collatedAnswers array has the same length as userAnswer
      if (collatedAnswers.length !== userAnswer.length) {
        collatedAnswers = Array(userAnswer.length).fill(0);
      }

      for (let i = 0; i < userAnswer.length; i++) {
        if (userAnswer[i]) {
          collatedAnswers[i]++;
        }
      }
    });

    return collatedAnswers;
  } catch (error) {
    throw error;
  }
}

app.get('/answerSummary/:componentID', async (req, res) => {
  const componentID = req.params.componentID;
  try {
    const answerSummary = await fetchAnswerSummary(componentID);
    res.json(answerSummary);
  } catch (error) {
    console.error('Error fetching answer summary:', error);
    res.status(500).json({ error: 'Error fetching answer summary' });
  }
});

// GET /interactions endpoint with query parameters
app.get('/interactions', async (req, res) => {
  try {
    const studentId = req.query.studentId;
    const _componentId = req.query.componentId;

    if (!studentId || !_componentId) {
      return res.status(400).json({ error: 'Both studentId and componentId query parameters are required.' });
    }

    var dbConnect = dbo.getDb();
    const interactionsCollection = dbConnect.collection('Interactions');
    // Query the database for matching documents and sort by timestamp in descending order (most recent first)
    const query = { studentId, _componentId };
    const sortOptions = { timestamp: -1 };
    const result = await interactionsCollection.find(query).sort(sortOptions).limit(1).toArray();

    if (result.length === 0) {
      return res.status(404).json({ error: 'No matching interaction found.' });
    }

    // Return the most recent interaction to the user
    res.status(200).json(result[0]);
  } catch (err) {
    // Handle any errors that occur during the database operation
    console.error('Error fetching interaction:', err);
    res.status(500).json({ error: 'Error fetching interaction' });
  }
});


app.get('/interactions/:id', async function(req, res) {
  const interactionId = req.params.id;

  // Check if the provided ID is a valid ObjectId
  if (!ObjectId.isValid(interactionId)) {
    return res.status(400).json({ error: 'Invalid ID format' });
  }

  try {

    var dbConnect = dbo.getDb();
    const interactionsCollection = dbConnect.collection('Interactions');

    // Find the interaction by its ID
    const interaction = await interactionsCollection.findOne({ _id: new ObjectId(interactionId) });

    if (interaction) {
      res.status(200).json(interaction);
    } else {
      res.status(404).json({ error: 'Interaction not found' });
    }
  } catch(err) {
    // Handle any errors that occur during the database operation
    console.error('Error fetching interaction:', err);
    res.status(500).json({ error: 'Error fetching interaction' });
  }
});

/* Require user to be logged in */

function unauthorised(res) {
  res.locals.pageTitle = "401 Unauthorised";
  return res.status(401).render("errors/401");
}

module.exports = {
  unauthorised,
  // Other exports as needed...
};

function forbidden(res) {
  res.locals.pageTitle = "403 Forbidden";
  return res.status(401).render("errors/403");
}


app.get('/profile', function(req, res) {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  res.locals.pageTitle = "Profile page";
  // Get the user's IP address
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (ip && ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  var dbConnect = dbo.getDb();
  dbConnect
      .collection("Users")
      .find({'emails.0.value': email})
      .toArray(function(err,items) {
        res.locals.profile = {};
        res.locals.profile.userType = items[0].userType;
        res.locals.profile.suspended = items[0].suspended;
        res.locals.profile.lastLogin = items[0].lastLogin;
        res.locals.profile.ip = ip;
        req.session.profile = res.locals.profile;
        res.render('pages/profile');
      });
});

app.post("/moodle/course-extractor", upload.single('file'), async (req, res) => {
  try {
    // Access the uploaded file's path
    const uploadedFilePath = req.file.path;

    // Create a temporary directory for processing
    const tmpDir = await tmp.dir();

    // Rename the file if it has a .mbz extension to .tar.gz for clarity
    if (path.extname(uploadedFilePath) === ".mbz") {
      const newPath = path.join(tmpDir.path, 'upload.tar.gz');
      await fs.rename(uploadedFilePath, newPath);
    } else {
      const newPath = path.join(tmpDir.path, 'upload.tar.gz');
      await fs.copy(uploadedFilePath, newPath);
    }

    // Extract .tar.gz to the temporary directory
    await tar.x({
      file: path.join(tmpDir.path, 'upload.tar.gz'),
      cwd: tmpDir.path,
    });

    // Perform the conversion using the extracted files in tmpDirPath
    const activitiesPath = path.join(tmpDir.path, "activities");
    const conversionResult = await xmlToHtml.convertFiles(activitiesPath);

    // Clean up the temporary directory
    await rimraf.sync(tmpDir.path);

    // Send a response indicating success
    res.send(conversionResult);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});


app.get('/moodle/course-extractor', function(req,res) {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  if (req.session.profile.userType == "user") { forbidden(res); return; }
  res.locals.pageTitle = "Course " + req.params.id;
  res.locals.id = req.params.id;
  res.render('pages/moodle-extractor');
});

app.get('/courses', function(req, res) {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  if (req.session.profile.userType == "user") { forbidden(res); return; }
  res.locals.pageTitle = "Courses";
  res.render('pages/courses');

});

app.get('/course/:id', function(req, res) {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  if (req.session.profile.userType == "user") { forbidden(res); return; }
  res.locals.pageTitle = "Course" + req.params.id;
  res.locals.id = req.params.id;
  res.locals.aatBase = aatBase + "/";
  res.render('pages/contentObject');
});

app.get('/course/:id/dashboard', function(req,res) {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  if (req.session.profile.userType == "user") { forbidden(res); return; }
  res.locals.pageTitle = "Course " + req.params.id;
  res.locals.id = req.params.id;
  res.render('pages/contentObjectDashboard');
});

app.get('/course/:id/transcript', function(req,res) {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  if (req.session.profile.userType == "user") { forbidden(res); return; }
  res.locals.pageTitle = "Course " + req.params.id;
  res.locals.id = req.params.id;
  res.render('pages/contentObjectTranscript');
});

app.get('/users/', function(req,res) {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  if (req.session.profile.userType != "admin") { forbidden(res); return; }
  res.locals.pageTitle = "Users";
  res.render('pages/users');
});

app.get('/user/:id', function(req,res) {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  if (req.session.profile.userType != "admin") { forbidden(res); return; }
  res.locals.pageTitle = "Edit user";
  res.render('pages/editUserProfile', {userid: req.params.id, msg: ""});
});

/* API requests private methods */

app.get('/api/activityData', function (req, res) {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  if (req.session.profile.userType == "user") { forbidden(res); return; }
  api.getActivityData(req, res, dbo);
});

/* The complete adapt API */

/**
 * api/courses
 * List all courses
 */
app.get('/api/courses', function(req,res) {
  if (!req.isAuthenticated() && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  if (req.session.profile.userType == "user") { forbidden(res); return; }
  adaptapi.getObjectsFromCollection(req, res, adaptdb, "courses");
});

app.get('/api/contentObjects', function(req,res) {
  if (!req.isAuthenticated() && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  if (req.session.profile.userType == "user") { forbidden(res); return; }
  adaptapi.getObjectsFromCollection(req, res, adaptdb, "contentobjects");
});

app.get('/api/contentObjects/summary', function(req,res) {
  if (!req.isAuthenticated() && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  if (req.session.profile.userType == "user") { forbidden(res); return; }
  adaptapi.getCacheData(req, res, adaptdb, dbo);
});

app.get('/api/courseDetail', function(req,res) {
  if (!req.isAuthenticated() && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  if (req.session.profile.userType == "user") { forbidden(res); return; }
  adaptapi.getCourses(req, res, dbo);
});

app.head('/api/contentObject/:id/transcript', function(req,res) {
  //if (!req.isAuthenticated() && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  //if (req.session.profile.userType == "user") { forbidden(res); return; }
  adaptapi.getContentObjectHead(req, res, adaptdb, req.params.id);
});

app.get('/api/contentObject/:id/transcript', function(req,res) {
  //if (!req.isAuthenticated() && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  //if (req.session.profile.userType == "user") { forbidden(res); return; }
  adaptapi.getContentObjectTranscript(req, res, adaptdb, req.params.id);
});

app.get('/api/contentObject/:id/outcomesMetadata', function(req,res) {
  //if (!req.isAuthenticated() && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  //if (req.session.profile.userType == "user") { forbidden(res); return; }
  adaptapi.getContentObjectOutcomesMetadata(req, res, adaptdb, req.params.id);
});

app.head('/api/contentObject/:id', function(req,res) {
  //if (!req.isAuthenticated() && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  //if (req.session.profile.userType == "user") { forbidden(res); return; }
  adaptapi.getContentObjectHead(req, res, adaptdb, req.params.id);
});

app.get('/api/contentObject/:id', function(req,res) {
  if (!req.isAuthenticated() && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  if (req.session.profile.userType == "user") { forbidden(res); return; }
  adaptapi.getContentObject(req, res, adaptdb, req.params.id);
});

app.get('/api/course/:id/config', function(req,res) {
  if (!req.isAuthenticated() && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  if (req.session.profile.userType == "user") { forbidden(res); return; }
  adaptapi.getCourseConfig(req, res, adaptdb, req.params.id);
});

/*
 * Get Users
 *
 */
app.get('/api/users', function(req,res) {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  if (req.session.profile.userType != "admin") { forbidden(res); return; }
  userHandler.getUsers(req,res,dbo,req.query.format);
});
app.get('/api/user/:id', function(req,res) {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  if (req.session.profile.userType != "admin") { forbidden(res); return; }
  userHandler.getUser(req,res,dbo,req.params.id,req.query.format);
});
/*
 * Update user
 */
app.post('/user/:id', function(req, res, next){
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  if (req.session.profile.userType != "admin") { forbidden(res); return; }
  userHandler.updateUser(req,res,dbo,req.params.id);
});


/*
 * API requests, public methods
 */
app.get('/api/questionSummary', function (req, res) {
  api.getQuestionSummaryData(req, res, dbo);
});

/**
 * api/collection
 * Get all items in a collection for a specific parentId
 * e.g. api/contentobjects/?parentId=xxxxxx
 * e.g. api/blocks/?parentId=xxxxxx
 */
app.get('/api/:collection/', function(req,res) {
  if (!req.isAuthenticated() && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  if (req.session.profile.userType == "user") { forbidden(res); return; }
  if (req.query.parentId) {
    adaptapi.findObjectsWithParentId(req, res, adaptdb, req.params.collection, req.query.parentId);
  } else {
    return res.status(400).render("errors/400");
  }
});

/**
 * api/collection/:id
 * Get data for a single item e.g. article, course, block, component
 * e.g. api/contentobject/xxxxxx
 * e.g. api/block/xxxxxx
 */
app.get('/api/:collection/:id', function(req,res) {
  if (!req.isAuthenticated() && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  if (req.session.profile.userType == "user") { forbidden(res); return; }
  adaptapi.getObjectById(req, res, adaptdb, req.params.collection, req.params.id);
});

app.post('/api/:collection/:id', async function (req, res) {
  if (!req.isAuthenticated()) {
    unauthorised(res);
    return;
  }

  const collection = req.params.collection;
  const id = req.params.id;

  try {
    // Extract the JSON data from the request body
    const requestData = req.body;

    // Make an HTTP POST request to the external service using fetch
    const response = await fetch(aatBase + ':3035/' + collection + '/' + id, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData), // Pass the JSON data in the request body
    });

    // Check if the external service request was successful
    if (response.ok) {
      // Forward the response directly to the client
      response.body.pipe(res);
    } else {
      // Handle the case where the external service returns an error
      //console.error('External service returned an error:', response.statusText);
      res.status(response.status).send(response.statusText);
    }
  } catch (error) {
    // Handle any network or server errors
    console.error('Error calling external service:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/course/:courseId/resetPageLevelProgress', async function(req,res) {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  const courseId = req.params.courseId;

  try {
    // Make an HTTP GET request to the external service using fetch
    const response = await fetch(aatBase+':3035/resetPageLevelProgress?course-id='+courseId, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`External service returned status: ${response.status}`);
    }

    const data = await response.json();

    // Return the response from the external service
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Error calling external service:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/createAccess', async function (req, res) {
  // Check authentication
  if (!req.isAuthenticated()) {
      unauthorised(res);
      return;
  }

  // Extract data from the request body
  const { ip, email } = req.body;

  try {
      // Make a request to the firewall manager endpoint
      const response = await fetch(`${process.env.FIREWALL_MANAGER}/firewall`, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json'
          },
          body: JSON.stringify({ ip, email })
      });

      // Check if the request was successful
      if (!response.ok) {
          throw new Error('Failed to fetch firewall status');
      }

      // Parse the response JSON
      const data = await response.json();

      // Send the response back to the client
      res.json(data);
  } catch (error) {
      // Handle any errors
      console.error('Error fetching firewall status:', error.message);
      res.status(500).json({ error: 'Internal Server Error' });
  }
});


// Routes handled elsewhere
const packageHandler = require('./packageHandler');
app.use('/course/:courseId/packages', packageHandler);

//Keep this at the END!
app.get('*', function(req, res){
  res.locals.pageTitle = "404 Not Found";
  return res.status(404).render("errors/404");
});

adaptdb.connectToServer(function (err) {
  if(err) {
    console.log(err);
  }
});

if (process.env.UPDATE_COURSE_CACHE == "true") {
  setTimeout(() => {
    adaptapi.updateCourseCache(adaptdb,dbo);
  },1000);

  setInterval(() => {
    adaptapi.updateCourseCache(adaptdb,dbo);
  },1800000);
}

/* Run server */

// perform a database connection when the server starts
dbo.connectToServer(function (err) {
  if (err) {
    console.error(err);
    process.exit();
  }

  const port = process.env.PORT || 80;
  // start the Express server
  var httpServer = http.createServer(app);
  httpServer.listen(port, () => {
    console.log(`Server is running on port: ${port}`);
  });
  if (process.env.SSLKEY) {
    const securePort = process.env.SECUREPORT || 443;
    var httpsServer = https.createServer(credentials,app);
    httpsServer.listen(securePort, () => {
      console.log(`Server is running on port: 443`);
    });
  }

});
