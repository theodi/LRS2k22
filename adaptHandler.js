var ObjectId = require('mongodb').ObjectID;
var json2csv = require('json2csv'); // Library to create CSV for output
var promiseCount = 0;

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

// coursesSummary

var promises = [];
var output = {};
output.courses = {};

function removeHTML(str){
	if (str) {
		return str.replace(/(<([^>]+)>)/gi, "");
	} else	{
		return "";
	}
    /*
    var tmp = document.createElement("DIV");
    tmp.innerHTML = str;
    return tmp.textContent || tmp.innerText || "";
    */
}

function processData(dbo,data,parent_id,collection,path) {
	/*
	if (parent_id == "64761c44b38aaf6b93dd9074") {
		console.log("in processData for parent 64761c44b38aaf6b93dd9074 with collection" + collection + " and data:");
		console.log(JSON.stringify(data));
	}
	*/
	var local = {};
	//local.length = data.length;
	var paths = path.toString().split("_");
	if (collection == "articles") {
		output["courses"][paths[0]]["contentobjects"][paths[1]]["articleCount"] = data.length;
	}
	if (collection == "blocks") {
		if (!output["courses"][paths[0]]["contentobjects"][paths[1]]["blockCount"]) {
			output["courses"][paths[0]]["contentobjects"][paths[1]]["blockCount"] = 0;
		}
		output["courses"][paths[0]]["contentobjects"][paths[1]]["blockCount"] += data.length;
	}
	for(i=0;i<data.length;i++) {
		var id = data[i]._id;
		local[id] = {};
		local[id].wordCount = 0;
		local[id].title = data[i].title;
		local[id].id = id;
		if (data[i]._sortOrder) { local[id].sortOrder = data[i]._sortOrder; }
		local[id].displayTitle = data[i].displayTitle;
		local[id].description = data[i].body;
		local[id].wordCount += removeHTML(data[i].displayTitle).split(" ").length + removeHTML(data[i].body).split(" ").length;
		
		if (collection == "components") {
			local[id].type = data[i]._component;
			try {
				if (data[i].properties._items) {
					items = data[i].properties._items;
					for (var ci=0;ci<items.length;ci++){
						local[id].wordCount += removeHTML(items[ci].title).split(" ").length;
						local[id].wordCount += removeHTML(items[ci].body).split(" ").length;
						local[id].wordCount += removeHTML(items[ci].text).split(" ").length;
					}
				}
			} catch(err) {
				if (parent_id == "6438250bb38aaf6b93dd83a7") {
					console.log("error on parent: " + parent_id);
					console.log(err);
				}
			}
			try {
				if (data[i].properties._feedback) {
					local[id].isQuestion = true;
					if (!output["courses"][paths[0]]["contentobjects"][paths[1]]["questionCount"]) {
						output["courses"][paths[0]]["contentobjects"][paths[1]]["questionCount"] = 0;
					}
					output["courses"][paths[0]]["contentobjects"][paths[1]]["questionCount"] += 1;
					local[id].wordCount += removeHTML(data[i].properties._feedback.correct).split(" ").length;
					local[id].wordCount += removeHTML(data[i].properties._feedback._incorrect.final).split(" ").length;
				}
			} catch(err) {
				if (parent_id == "6438250bb38aaf6b93dd83a7") {
					console.log("error on parent: " + parent_id);
					console.log(err);
				}
			}
		}
		
		if (paths.length > 1) {
			output["courses"][paths[0]]["contentobjects"][paths[1]]["wordCount"] += local[id].wordCount;
		}
		
		if (collection == "contentobjects") {
			promiseCount = promiseCount + 1;
			getChildren(dbo,id,"articles",path + "_" + id);
		}
		if (collection == "articles") {
			if (!output["courses"][paths[0]]["contentobjects"][paths[1]]["assessmentCount"]) {
				output["courses"][paths[0]]["contentobjects"][paths[1]]["assessmentCount"] = 0;
			}
			try {
				if (data[i]._extensions._assessment._isEnabled) {
					local[id].assessment = data[i]._extensions._assessment;
					output["courses"][paths[0]]["contentobjects"][paths[1]]["assessmentCount"] += 1;
				}
			} catch(err) {}
			promiseCount = promiseCount + 1;
			getChildren(dbo,id,"blocks",path + "_" + id);
		}
		if (collection == "blocks") {
			promiseCount = promiseCount + 1;
			getChildren(dbo,id,"components",path + "_" + id);
		}
		promiseCount = promiseCount - 1;
	}

	if (collection == "contentobjects") {
		output["courses"][parent_id][collection] = local;
	} else {
		if (collection == "articles") {
			output["courses"][paths[0]]["contentobjects"][paths[1]]["articles"] = local;
		} else if (collection == "blocks") {
			output["courses"][paths[0]]["contentobjects"][paths[1]]["articles"][paths[2]]["blocks"] = local;
		} else if (collection == "components") {
			output["courses"][paths[0]]["contentobjects"][paths[1]]["articles"][paths[2]]["blocks"][paths[3]]["components"] = local;
		} else {
			output[collection][parent_id] = local;
		}
	}
}

function makeCSVOutput(output) {
	var csvOutput = [];
	courses = output.courses;
	for (const [key, value] of Object.entries(courses)) {
		var courseTitle = value.title;
		var contentObjects = value.contentobjects;
		for (const [cokey, covalue] of Object.entries(contentObjects)) {
 			var item = {};
 			item.courseTitle = courseTitle;
 			item.title = covalue.title;
 			item.description = covalue.description;
 			item.articleCount = covalue.articleCount;
 			item.blockCount = covalue.blockCount;
 			item.wordCount = covalue.wordCount;
 			item.assessmentCount = covalue.assessmentCount;
 			if (item.title) {
 				csvOutput.push(item);
 			}
 		}
	}
	return csvOutput;
}

function setPromiseInterval(req,res) {
	var resolve = setInterval(() => {
		console.log(promiseCount);
		if (promiseCount < 1) {
		    Promise.all(promises).then((values) => {
				clearInterval(resolve);
				if (req.query.format == "csv") {
					res.set('Content-Type', 'text/csv');
					res.send(json2csv({data: makeCSVOutput(output) }));
				} else {
					res.set('Content-Type', 'application/json');
	        		res.send(JSON.stringify(output, null, 4));
	        	}
			});
		}
	},20000);
}

function setPromiseInterval2(req,res,id) {
	var resolve = setInterval(() => {
		Promise.all(promises).then((values) => {
			clearInterval(resolve);
			if (req.query.format == "csv") {
				res.set('Content-Type', 'text/csv');
				res.send(json2csv({data: makeCSVOutput(output["courses"][0]["contentobjects"][id]) }));
			} else {
				res.set('Content-Type', 'application/json');
	       		res.send(JSON.stringify(output["courses"][0]["contentobjects"][id], null, 4));
	       	}
		});
	},2000);
}

function getChildren(dbo,parent_id,collection,path) {
	if (parent_id == "6438250bb38aaf6b93dd83a7") {
		//console.log("Getting children for block 6438250bb38aaf6b93dd83a7");
	}
	promiseCount = promiseCount + 1;
	var dbConnect = dbo.getDb();
	dbConnect
		.collection(collection)
         .find({"_parentId":new ObjectId(parent_id)})
        .toArray(function(err,data) {
        	if (parent_id == "6438250bb38aaf6b93dd83a7") {
        		//console.log("data for 6438250bb38aaf6b93dd83a7");
        		//console.log(JSON.stringify(data));
        	}
        	promises.push(new Promise((resolve,reject) => {
            	resolve(processData(dbo,data,parent_id,collection,path));
        	}));
        });
}

function updateCache(dbo) {
  var resolve = setInterval(() => {
    Promise.all(promises).then((values) => {
      console.log("Updating database");
      clearInterval(resolve);
      
      // Delete all documents in the collection
      var dbConnect = dbo.getDb();
      dbConnect.collection("AdaptCourseCache").deleteMany({});
      
      courses = output["courses"];
      var insertPromises = [];
      
      // Insert new documents
      for (const [key, value] of Object.entries(courses)) {
        insertPromises.push(
          dbConnect.collection("AdaptCourseCache").insertOne({_id: new ObjectId(key), ...value})
        );
      }
      
      Promise.all(insertPromises).then(() => {
        console.log("Documents inserted successfully");
      }).catch((error) => {
        console.error("Error inserting documents:", error);
      });
    });
  }, 120000);
}

function getConfig(dbo,id) {
	var collection = "configs";
	var dbConnect = dbo.getDb();
	dbConnect
		.collection(collection)
        .find({"_courseId":new ObjectId(id)})
        .toArray(function(err,data) {
        	output["courses"][id]["config"] = data[0];
        	if (data[0]._themePreset) {
        		getThemePreset(dbo,id,data[0]._themePreset);
        	}
        })
}

function getThemePreset(dbo,id,themeid) {
	var collection = "themepresets";
	var dbConnect = dbo.getDb();
	dbConnect
		.collection(collection)
        .find({"_id":new ObjectId(themeid)})
        .toArray(function(err,data) {
        	output["courses"][id]["config"]["_themePreset"] = data[0];
        })
}

exports.updateCourseCache = function(dbo,localdb) {
	console.log("Updating course cache");
	var collection = "courses";
	var dbConnect = dbo.getDb();
	dbConnect
		.collection(collection)
        .find({})
        .toArray(function(err,data) {
			for(i=0;i<data.length;i++) {
				var courseData = {};
				id = data[i]._id;
				output["courses"][id] = {};
				output["courses"][id].title = data[i].displayTitle;
				output["courses"][id]["contentobjects"] = {};
				path = id;
				getConfig(dbo,id);
				getChildren(dbo,id,"contentobjects",path);
			}
			updateCache(localdb);
		});
}


exports.getCourses = function(req, res, dbo) {
	var collection = "AdaptCourseCache";
	var dbConnect = dbo.getDb();
	dbConnect
		.collection(collection)
        .find({})
        .toArray(function(err,data) {
        	if (req.query.format == "csv") {
				res.set('Content-Type', 'text/csv');
				res.send(json2csv({data: makeCSVOutput(data) }));
			} else {
				res.set('Content-Type', 'application/json');
	        	res.send(JSON.stringify(data, null, 4));
	        }
		});
}

exports.getContentObject = function(req, res, dbo, id) {
	var collection = "AdaptCourseCache";
	var dbConnect = dbo.getDb();
	var firstPart = "contentobjects." + id + ".id";
	var query = {};
	query[firstPart] = ObjectId(id);
	dbConnect
		.collection(collection)
        .findOne(query,function(err,data) {     		
        	for (const [key, value] of Object.entries(data.contentobjects)) {
        		if (key == id) {
        			if (req.query.format == "csv") {
						res.set('Content-Type', 'text/csv');
						res.send(json2csv({data: makeCSVOutput(value) }));
					} else {
						res.set('Content-Type', 'application/json');
	       				res.send(JSON.stringify(value, null, 4));
			       	}	
			    }
			}
		});
}


exports.getContentObjectConfig = function(req, res, dbo, id) {
	var collection = "AdaptCourseCache";
	var dbConnect = dbo.getDb();
	var firstPart = "contentobjects." + id + ".id";
	var query = {};
	query[firstPart] = ObjectId(id);
	dbConnect
		.collection(collection)
        .findOne(query,function(err,data) {
        	if (req.query.format == "csv") {
				res.set('Content-Type', 'text/csv');
				res.send(json2csv({data: makeCSVOutput(data.config) }));
			} else {
				res.set('Content-Type', 'application/json');
	       		res.send(JSON.stringify(data.config, null, 4));
			}	
		});
}
