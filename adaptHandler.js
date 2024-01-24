var ObjectId = require('mongodb').ObjectID;
const { ObjectID } = require('bson');
const { Parser } = require('@json2csv/plainjs'); // Library to create CSV for output

// Function to retrieve an object by ID and handle tags
async function getObjectById(dbConnect, collection, id) {
	collection = collection + "s";

	return new Promise(async (resolve, reject) => {
	  try {
		const items = await dbConnect.collection(collection).find({ "_id": new ObjectId(id) }).toArray();

		if (items.length === 0) {
		  resolve(null); // Object not found, return null
		} else {
		  const objectData = items[0];

		  // Check if the object has a tags array
		  if (objectData.tags && Array.isArray(objectData.tags) && objectData.tags.length > 0) {
			const tagIds = objectData.tags.map(tag => new ObjectId(tag));

			// Query the tags collection to get tag titles
			const tagItems = await dbConnect.collection("tags").find({ "_id": { $in: tagIds } }).toArray();

			// Convert the tags array to objects with _tagId and title
			const tagsWithTitles = tagItems.map(tagItem => ({ _tagId: tagItem._id, title: tagItem.title }));

			// Update the objectData with the tags with titles
			objectData.tags = tagsWithTitles;
		  }

		  resolve(objectData);
		}
	  } catch (err) {
		reject(err);
	  }
	});
  }

  // Function to handle JSON response
  exports.getObjectById = async function(req, res, dbo, collection, id) {
	const dbConnect = dbo.getDb();

	try {
	  const objectData = await getObjectById(dbConnect, collection, id);

	  if (!objectData) {
		console.log("Object not found");
		return res.status(404).json({ error: "Object not found" });
	  }

	  res.set('Content-Type', 'application/json');
	  res.send(JSON.stringify(objectData, null, 4));
	} catch (err) {
	  console.error("Error:", err);
	  res.status(500).json({ error: "An error occurred" });
	}
  };


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

// Function to retrieve items from the collection
async function getItemsFromCollection(dbConnect, collection) {
	return await dbConnect.collection(collection).find({}).toArray();
}

  // Function to handle JSON response
exports.getObjectsFromCollection = async function(req, res, dbo, collection) {
	const dbConnect = dbo.getDb();

	try {
	  const items = await getItemsFromCollection(dbConnect, collection);
	  res.set('Content-Type', 'application/json');
	  res.send(JSON.stringify(items, null, 4));
	} catch (err) {
	  console.error("Error:", err);
	  res.status(500).json({ error: "An error occurred" });
	}
};

function stripHtmlTags(input) {
	return input.replace(/<[^>]*>/g, " ");
  }

async function getWordCount(object) {
	var count = 0;

	// Calculate word count for displayTitle and body
	if (object.displayTitle && typeof object.displayTitle === 'string') {
	  count += object.displayTitle.split(/\s+/).length;
	}

	if (object.body && typeof object.body === 'string') {
	  // Strip HTML tags from the body before calculating word count
	  const bodyWithoutHtml = stripHtmlTags(object.body);
	  count += bodyWithoutHtml.split(/\s+/).length;
	}

	if (
	  object._extensions &&
	  object._extensions._extra &&
	  object._extensions._extra._items &&
	  Array.isArray(object._extensions._extra._items)
	) {
	  object._extensions._extra._items.forEach(item => {
		if (item.title && typeof item.title === 'string') {
		  count += item.title.split(/\s+/).length;
		}

		if (item.body && typeof item.body === 'string') {
		  // Strip HTML tags from the item's body before calculating word count
		  const itemBodyWithoutHtml = stripHtmlTags(item.body);
		  count += itemBodyWithoutHtml.split(/\s+/).length;
		}
	  });
	}

	if (object.properties && object.properties._items && Array.isArray(object.properties._items)) {
	  object.properties._items.forEach(propertyItem => {
		if (propertyItem.displayTitle && typeof propertyItem.displayTitle === 'string') {
		  count += propertyItem.displayTitle.split(/\s+/).length;
		}

		if (propertyItem.body && typeof propertyItem.body === 'string') {
		  // Strip HTML tags from the property item's body before calculating word count
		  const propertyBodyWithoutHtml = stripHtmlTags(propertyItem.body);
		  count += propertyBodyWithoutHtml.split(/\s+/).length;
		}

		if (propertyItem.text && typeof propertyItem.text === 'string') {
		  count += propertyItem.text.split(/\s+/).length;
		}
	  });
	}

	// Calculate word count for properties._feedback.correct and strip HTML tags
	if (
	  object.properties &&
	  object.properties._feedback &&
	  object.properties._feedback.correct &&
	  typeof object.properties._feedback.correct === 'string'
	) {
	  const feedbackCorrectWithoutHtml = stripHtmlTags(object.properties._feedback.correct);
	  count += feedbackCorrectWithoutHtml.split(/\s+/).length;
	}
	return count;
}

/*
 * New function 2024-01-03
 */
// Function to build contentData
async function buildContentData(dbConnect, id) {
	const contentCollection = "contentobjects";
	const articlesCollection = "articles";
	const blocksCollection = "blocks";
	const componentsCollection = "components";

	const contentData = await dbConnect.collection(contentCollection).findOne({ "_id": new ObjectId(id) });

	if (!contentData) {
	  throw new Error("Content object not found");
	}

	const articlesData = await dbConnect.collection(articlesCollection).find({ "_parentId": new ObjectId(id) }).toArray();
	contentData.totalArticleCount = articlesData.length;
	contentData.totalBlockCount = 0;
	contentData.totalComponentCount = 0;
	contentData.assessmentCount = 0;
	contentData.questionCount = 0;
	contentData.wordCount = 0;

	for (const article of articlesData) {
	  try {
		if (article._extensions._assessment._isEnabled === true) {
		  contentData.assessmentCount += 1;
		}
	  } catch (err) {}

	  article.wordCount = await getWordCount(article);
	  contentData.wordCount += article.wordCount;

	  const blocksData = await dbConnect.collection(blocksCollection).find({ "_parentId": new ObjectId(article._id) }).toArray();
	  article.totalComponentCount = 0;

	  for (const block of blocksData) {
		block.wordCount = await getWordCount(block);
		contentData.wordCount += block.wordCount;
		const componentsData = await dbConnect.collection(componentsCollection).find({ "_parentId": new ObjectId(block._id) }).toArray();

		for (const component of componentsData) {
		  component.wordCount = await getWordCount(component);
		  block.wordCount += component.wordCount;
		  contentData.wordCount += component.wordCount;
		  component.isQuestion = false;
		  try {
			if (component.properties._feedback) {
			  component.isQuestion = true;
			  contentData.questionCount += 1;
			}
		  } catch (err) {}
		}
		article.wordCount += block.wordCount;
		block.components = componentsData;
		block.componentCount = componentsData.length;
		article.totalComponentCount += block.componentCount;
		contentData.totalComponentCount += block.componentCount;
	  }
	  blocksData.sort((a, b) => a._sortOrder - b._sortOrder);
	  article.blocks = blocksData;
	  contentData.totalBlockCount += blocksData.length;
	}
	articlesData.sort((a, b) => a._sortOrder - b._sortOrder);
	contentData.articles = articlesData;

	return contentData;
}

async function buildCache(dbConnect) {
	const contentCollection = "contentobjects";

	try {
	  // Step 1: Get all contentobjects
	  const contentObjects = await getItemsFromCollection(dbConnect, contentCollection);

	  const contentObjectsData = await Promise.all(contentObjects.map(async (contentObject) => {
		// Step 2: Get courseData
		const courseData = await getObjectById(dbConnect, "course", contentObject._courseId);

		// Step 3: Build contentData
		const contentData = await buildContentData(dbConnect, contentObject._id);

		// Step 4: Collate data
		const tagTitles = (courseData.tags || []).map(tag => tag.title).join(', ');
		const collatedContentObject = {
		  _id: contentObject._id,
		  _courseId: contentObject._courseId,
		  courseTitle: courseData.displayTitle,
		  title: contentObject.displayTitle,
		  tags: tagTitles,
		  totalArticleCount: contentData.totalArticleCount,
		  totalBlockCount: contentData.totalBlockCount,
		  totalComponentCount: contentData.totalComponentCount,
		  assessmentCount: contentData.assessmentCount,
		  questionCount: contentData.questionCount,
		  wordCount: contentData.wordCount,
		};

		return collatedContentObject;
	  }));

	  return contentObjectsData;
	} catch (err) {
	  throw err;
	}
}

async function updateCache(sourcedb, destinationdb) {
	try {
		const sourceDbConnect = sourcedb.getDb();
		const destinationDbConnect = destinationdb.getDb();

		// Step 1: Get cache data from sourceDb
		console.log("Updating cache");
		const cacheData = await buildCache(sourceDbConnect);

		// Step 2: Delete existing data in the courseCache collection of destinationDb
		await destinationDbConnect.collection("courseCache").deleteMany({});

		// Step 3: Insert the new cache data into the courseCache collection
		await destinationDbConnect.collection("courseCache").insertMany(cacheData);

		console.log("Cache updated successfully.");
	  } catch (err) {
		console.error("Error:", err);
	  }
}

exports.updateCourseCache = async function (sourcedb, destinationdb) {
	updateCache(sourcedb,destinationdb);
};


exports.getCacheData = async function (req, res, sourceDb, cacheDb) {
	try {
	  const dbConnect = cacheDb.getDb(); // Use cacheDb as the default source

	  // Check if forceUpdate is set to true in the request
	  const forceUpdate = req.query.forceUpdate === 'true';

	  if (forceUpdate) {
		// If forceUpdate is true, update the cache and then read it
		await updateCache(sourceDb, cacheDb); // Assuming you have an updateCache function
	  }

	  // Read all objects from the courseCache collection in cacheDb
	  const cachedContentObjects = await dbConnect.collection("courseCache").find({}).toArray();

	  // Content negotiation based on Accept header
	  const acceptHeader = req.headers['accept'];

	  if (acceptHeader.includes('text/csv')) {
		// Respond with CSV
		const parser = new Parser({ header: true });
        const csv = parser.parse(cachedContentObjects);
        res.set('Content-Type', 'text/csv');
        res.send(csv);
	  } else {
		// Default to JSON
		res.set('Content-Type', 'application/json');
		res.json(cachedContentObjects);
	  }
	} catch (err) {
	  console.error("Error:", err);
	  res.status(500).json({ error: "An error occurred" });
	}
};


// Function to handle JSON response
exports.getContentObject = async function(req, res, dbo, id) {
	const dbConnect = dbo.getDb();

	try {
	  const contentData = await buildContentData(dbConnect, id);
	  res.json(contentData);
	} catch (err) {
	  console.error("Error:", err);
	  if (err.message === "Content object not found") {
		res.status(404).json({ error: "Content object not found" });
	  } else {
		res.status(500).json({ error: "An error occurred" });
	  }
	}
};

/*
 * Updated function 2024-01-03
 */
exports.getCourseConfig = function(req, res, dbo, id) {
	var collection = "configs";
	var dbConnect = dbo.getDb();
	var query = {"_courseId": new ObjectId(id)};
	dbConnect
		.collection(collection)
		.findOne(query, function(err, data) {
			if (err) {
				console.error("Error while retrieving object:", err);
				res.status(500).json({ error: "An error occurred while retrieving content object" });
				return;
			}

			if (!data) {
				console.log("Object not found");
				res.status(404).json({ error: "Object not found" });
				return;
			}
			res.json(data);
		});
}