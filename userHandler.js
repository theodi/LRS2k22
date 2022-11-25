var json2csv = require('json2csv'); // Library to create CSV for output

exports.insertUser = function(res,dbo,profile) {
	profile.suspended = false;
	profile.userType = "user";
	var dbConnect = dbo.getDb();
	dbConnect
      .collection("Users")
      .insertOne(profile);
}

exports.updateLastLoginTime = function(res,dbo,email) {
	var date = new Date().toISOString();
	var dbConnect = dbo.getDb();
	dbConnect
      .collection("Users")
      .updateOne({'emails.0.value': email}, { $set: { lastLogin: date }});
}

exports.getUsers = function(req,res,dbo,format) {
	var dbConnect = dbo.getDb();
	dbConnect
      .collection("Users")
      .find()
      .toArray(function(err,items) {
      	if (format=="text/csv") {
      		res.set('Content-Type', 'text/csv');
			res.send(json2csv({data: makeCSVOutput(items) }));
		} else {
			res.set('Content-Type', 'application/json');
	        res.send(JSON.stringify(items, null, 4));
		}
      });
}

function makeCSVOutput(users) {
	var output = [];
	for(i=0;i<users.length;i++) {
		var user = {};
		user = users[i]._json;
		user.suspended = users[i].suspended;
		user.type = users[i].userType;
		user.lastLogin = users[i].lastLogin;
		output.push(user);
	}
	console.log(output);
	return output;

}