exports.insertUser = function(dbo,profile) {
	profile.suspended = false;
	profile.userType = "viewer";
	var dbConnect = dbo.getDb();
	dbConnect
      .collection("Users")
      .insertOne(profile);
}

exports.updateLastLoginTime = function(dbo,email) {
	var date = new Date().toISOString();
	var dbConnect = dbo.getDb();
	dbConnect
      .collection("Users")
      .updateOne({'emails.0.value': email}, { $set: { lastLogin: date }});
}