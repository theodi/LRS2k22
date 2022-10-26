var ObjectId = require('mongodb').ObjectID;

exports.getObjectById = function(req,res,dbo,collection,id) {
	var dbConnect = dbo.getDb();
	collection = collection + "s";
	dbConnect
		.collection(collection)
        .find({"_id":new ObjectId(id)})
        .toArray(function(err,items) {
        	res.set('Content-Type', 'application/json');
        	res.send(JSON.stringify(items[0], null, 4));
        });
}

exports.findObjectsWithParentId = function(req,res,dbo,collection,parent_id) {
	var dbConnect = dbo.getDb();
	dbConnect
		.collection(collection)
         .find({"_parentId":new ObjectId(parent_id)})
        .toArray(function(err,items) {
        	// TODO error handling
        	res.set('Content-Type', 'application/json');
        	res.send(JSON.stringify(items, null, 4));
        });
}

exports.getObjectsFromCollection = function(req,res,dbo,collection) {
	var dbConnect = dbo.getDb();
	dbConnect
		.collection(collection)
        .find({})
        .toArray(function(err,items) {
        	// TODO error handling
        	res.set('Content-Type', 'application/json');
        	res.send(JSON.stringify(items, null, 4));
        });
}