const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { unauthorised } = require('./index.js');
const AdmZip = require('adm-zip');

// Configure multer for handling file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const courseId = getCourseId(req);
    const packageType = file.fieldname; // 'build' or 'source'
    const packageDir = path.join(__dirname, 'packages', courseId, packageType);
    fs.mkdirSync(packageDir, { recursive: true });
    cb(null, packageDir);
  },
  filename: function (req, file, cb) {
    const courseId = getCourseId(req);
    const packageType = file.fieldname; // 'build' or 'source'
    const timestamp = Date.now();
    const filename = `${courseId}-${timestamp}-${packageType}.zip`;
    cb(null, filename);
  },
});

function getCourseId(req) {
  const pathname = req._parsedOriginalUrl.pathname;
  const regex = /\/course\/([^/]+)\/.*/;
  const match = pathname.match(regex);

  if (!match || match.length < 2) {
    return false;
  }

  return match[1];
}

const upload = multer({ storage });

// Handle package uploads at /course/<courseId>/upload
router.post('/upload', upload.fields([
  { name: 'build', maxCount: 1 },
  { name: 'source', maxCount: 1 },
]), (req, res) => {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  // Extract the courseId from the URL path
  const courseId = getCourseId(req);

  // Handle package upload and store file names in a database or an array
  const buildPackage = req.files['build'] ? req.files['build'][0].filename : null;
  const sourcePackage = req.files['source'] ? req.files['source'][0].filename : null;

  // Store these package filenames in the correct directory based on the courseId
  if (buildPackage) {
    const buildPackagePath = path.join(__dirname, 'packages', courseId, 'build', buildPackage);
    const zip = new AdmZip(buildPackagePath);
    const zipEntries = zip.getEntries();

    const validZip = zipEntries.find((entry) => {
      return entry.entryName === 'imsmanifest.xml' || entry.entryName === 'tincan.xml';
    });

    if (!validZip) {
      // Delete the invalid SCORM package file
      fs.unlinkSync(buildPackagePath);
      return res.status(400).json({ error: 'Invalid BUILD package' });
    }
  }
  if (sourcePackage) {
    const sourcePackagePath = path.join(__dirname, 'packages', courseId, 'source', sourcePackage);

    const zip = new AdmZip(sourcePackagePath);
    const zipEntries = zip.getEntries();

    const validZip = zipEntries.find((entry) => {
      return entry.entryName === 'src/course/en/contentObjects.json';
    });

    if (!validZip) {
      // Delete the invalid source package file
      fs.unlinkSync(sourcePackagePath);
      return res.status(400).json({ error: 'Invalid SOURCE package' });
    }
  }

  // Send a response indicating success
  res.status(200).json({ message: 'Packages uploaded successfully.' });
});


// List packages in date order
router.get('/:packageType', (req, res) => {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  const packageType = req.params.packageType;
  const courseId = getCourseId(req);
  const packagesDir = path.join(__dirname, 'packages', courseId, packageType);

  fs.readdir(packagesDir, (err, files) => {
    if (err) {
      return res.status(200).json({});
    }

    // Filter out any non-zip files
    const zipFiles = files.filter((file) => file.endsWith('.zip'));

    // Sort the files by date (timestamp in filename)
    zipFiles.sort((a, b) => {
      const aTimestamp = parseInt(a.split('-')[1], 10);
      const bTimestamp = parseInt(b.split('-')[1], 10);
      return bTimestamp - aTimestamp;
    });

    // Return the sorted list of packages
    res.status(200).json({ packages: zipFiles });
  });
});

router.get('/:packageType/latest', (req, res) => {
  if (!req.isAuthenticated()) {
    // Define an array of allowed host names to check against
    const allowedHosts = ['moodle.learndata.info', 'odi-test.opensourcelearning.co.uk'];

    // Get the User-Agent header from the request
    const userAgent = req.headers['user-agent'];

    // Check if the User-Agent contains one of the allowed hosts
    const isUserAgentAllowed = allowedHosts.some((allowedHost) => userAgent.includes(allowedHost));

    if (!isUserAgentAllowed) {
      // Return an unauthorized response if the User-Agent does not match any of the allowed hosts
      unauthorised(res);
      return;
    }
  }
  const courseId = getCourseId(req);
  const packageType = req.params.packageType;
  const packagePath = path.join(__dirname, 'packages', courseId, packageType);

    // Read the list of files in the package directory
  fs.readdir(packagePath, (err, files) => {
    if (err) {
      console.error('Error reading package directory:', err);
      return res.status(500).json({ error: 'Error reading package directory' });
    }

    // Filter out any non-zip files
    const zipFiles = files.filter((file) => file.endsWith('.zip'));

    // Sort the files by date (timestamp in filename)
    zipFiles.sort((a, b) => {
      const aTimestamp = parseInt(a.split('-')[1], 10);
      const bTimestamp = parseInt(b.split('-')[1], 10);
      return bTimestamp - aTimestamp;
    });

    mostRecentPackage = zipFiles[0];

    if (!mostRecentPackage) {
      return res.status(404).json({ error: 'No packages found' });
    }

    // Stream the most recent package file as a download
    res.setHeader('Content-Disposition', `attachment; filename=${mostRecentPackage}`);
    res.setHeader('Content-Type', 'application/zip');
    fs.createReadStream(packagePath + "/" + mostRecentPackage).pipe(res);
  });
});

router.delete('/delete/:packageType/:packageFileName', (req, res) => {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  const courseId = getCourseId(req);
  const packageType = req.params.packageType;
  const packageFileName = req.params.packageFileName;
  const filePath = path.join(__dirname, 'packages', courseId, packageType, packageFileName);

  // Check if the file exists
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      // File doesn't exist
      console.error('File does not exist:', err);
      return res.status(404).json({ error: 'File not found' });
    }

    // Delete the file
    fs.unlink(filePath, (deleteErr) => {
      if (deleteErr) {
        // Error occurred while deleting the file
        console.error('Error deleting file:', deleteErr);
        return res.status(500).json({ error: 'Error deleting file' });
      }

      // File deleted successfully
      res.status(200).json({ message: 'File deleted successfully' });
    });
  });
});

router.get('/:packageType/:packageFileName', (req, res) => {
  if (!req.isAuthenticated()) {
    // Define an array of allowed host names to check against
    const allowedHosts = ['moodle.learndata.info', 'odi-test.opensourcelearning.co.uk'];

    // Get the User-Agent header from the request
    const userAgent = req.headers['user-agent'];

    // Check if the User-Agent contains one of the allowed hosts
    const isUserAgentAllowed = allowedHosts.some((allowedHost) => userAgent.includes(allowedHost));

    if (!isUserAgentAllowed) {
      // Return an unauthorized response if the User-Agent does not match any of the allowed hosts
      unauthorised(res);
      return;
    }
  }
  const courseId = getCourseId(req);
  const packageType = req.params.packageType;
  const packageFileName = req.params.packageFileName;
  const filePath = path.join(__dirname, 'packages', courseId, packageType, packageFileName);

  // Check if the file exists
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      // File doesn't exist
      console.error('File does not exist:', err);
      return res.status(404).json({ error: 'File not found' });
    }

    // Stream the package file as a download
    res.setHeader('Content-Disposition', `attachment; filename=${packageFileName}`);
    res.setHeader('Content-Type', 'application/zip');

    const fileStream = fs.createReadStream(filePath);

    // Handle stream errors
    fileStream.on('error', (streamErr) => {
      console.error('Error streaming file:', streamErr);
      res.status(500).json({ error: 'Error streaming file' });
    });

    fileStream.pipe(res);
  });
});

module.exports = router;
