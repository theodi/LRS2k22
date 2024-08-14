var ObjectId = require('mongodb').ObjectID;
const cheerio = require('cheerio');
const { ObjectID } = require('bson');
const { Parser } = require('@json2csv/plainjs'); // Library to create CSV for output

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

async function getItemsFromCollection(dbConnect, collection) {
	return await dbConnect.collection(collection).find({}).toArray();
}

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

function htmlToPlainText(html) {
    // Load the HTML string into a Cheerio instance
    const $ = cheerio.load(html);

    // Find all <li> elements
    const listItems = $('li');

    // Iterate over each <li> element
    listItems.each((index, listItem) => {
        // Get the text content of the <li> element
        const listItemText = $(listItem).text().trim();

        // Determine whether to add a newline at the beginning or end
        const newline = index === 0 ? '\n' : '';

        // Replace the <li> element with a plain text equivalent with a dash and newline
        $(listItem).replaceWith(`${newline}- ${listItemText}${index === listItems.length - 1 ? '' : '\n'}`);
    });

    // Get the text content of the modified HTML
    const plainText = $('body').text().trim();

    return plainText;
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

function isQuestion(components){
	let primaryComponent;
	if (components.length === 1) {
		// If there's only one component, it's the primary component
		primaryComponent = components[0];
	} else {
		// Check for a component with .properties._feedback
		const feedbackComponent = components.find(component => component.properties && component.properties._feedback);
		if (feedbackComponent) {
			return true;
		} else {
			return false;
		}
	}
};

function getElementAsJson(data, question) {
    let json = {};

    if (data.displayTitle.trim() !== "") {
        json.title = data.displayTitle.trim();
        json.type = question ? "Question" : "Title";
    }

    if (data.body.trim() !== "") {
        json.body = data.body.trim();  // Retain HTML content as is
    }

    if (data._extensions && data._extensions._extra && data._extensions._extra._isEnabled === true) {
        json.extraItems = (data._extensions._extra._items || []).map(item => {
            let extraItem = {};
            if (item.title.trim() !== "") {
                extraItem.title = item.title.trim();
            }
            if (item.body.trim() !== "") {
                extraItem.body = item.body.trim();  // Retain HTML content as is
            }
            return extraItem;
        });
    }

    if (data.properties) {
        json.properties = {};
        if (data.properties._feedback) {
            json.properties.instruction = data.properties.instruction;

            json.properties.items = (data.properties._items || []).map(item => {
                let itemDetails = {};
                if (item._options) {
                    itemDetails.text = item.text.trim();  // Retain HTML content as is
                    itemDetails.options = (item._options || []).map(option => ({
                        text: option.text.trim(),
                        isCorrect: option._isCorrect
                    }));
                } else {
                    itemDetails.text = item.text.trim();  // Retain HTML content as is
                    itemDetails.shouldBeSelected = item._shouldBeSelected;
                }
                return itemDetails;
            });

            json.properties.feedback = {
                correct: data.properties._feedback.correct ? data.properties._feedback.correct.trim() : undefined,
                incorrect: data.properties._feedback._incorrect.final ? data.properties._feedback._incorrect.final.trim() : undefined
            };
        } else {
            json.properties.instruction = data.properties.instruction;
            if (data.properties._completionBody) {
                json.properties.completionBody = data.properties._completionBody.trim();
            }

            json.properties.items = (data.properties._items || []).map(item => {
                let itemDetails = {};
                if (item.title !== "") {
                    itemDetails.title = item.title;
                }
                if (item.body !== "") {
                    itemDetails.body = item.body;  // Retain HTML content as is
                }
                if (item.text !== "") {
                    itemDetails.text = item.text;  // Retain HTML content as is
                }
                return itemDetails;
            });
        }
    }

    return json;
}


function getElementAsText(data,question) {
	var ret = "";
	if (data.displayTitle.trim() != "") {
		if (question) {
			ret += "Question:";
		} else {
			ret += "Title:"
		}
		ret += data.displayTitle.trim() + "\n";
	}
	if (data.body.trim() != "") {
		ret += stripHtmlTags(htmlToPlainText(data.body)).replace(/&nbsp;/g, ' ').trim() + "\n\n";
	}
	if (data._extensions && data._extensions._extra && data._extensions._extra._isEnabled === true) {
		(data._extensions._extra._items).forEach(item => {
			if (item.title.trim() != "") {
				ret += item.title.trim() + "\n";
			}
			if (item.body.trim() != "") {
				ret += stripHtmlTags(htmlToPlainText(item.body)).replace(/&nbsp;/g, ' ').trim() + "\n\n";
			}
		});
	}
	if (data.properties) {
		if (data.properties._feedback) {
			//Question instruction
			ret += data.properties.instruction + "\n";
			(data.properties._items).forEach(item => {
				if(item._options) {
					ret += "- " + stripHtmlTags(item.text).replace(/&nbsp;/g, ' ').trim();
					(item._options).forEach(option => {
						if (option._isCorrect) {
							ret += " (Correct answer: " + option.text + ")";
						}
					});
					ret += "\n";
				} else {
					if (item._shouldBeSelected) {
						ret += "- Correct answer: " + stripHtmlTags(item.text).replace(/&nbsp;/g, ' ').trim() + "\n";
					} else {
						ret += "- Incorrect answer: " + stripHtmlTags(item.text).replace(/&nbsp;/g, ' ').trim() + "\n";
					}
				}
			});
			ret += "\n";
			if ( data.properties._feedback.correct ) {
				ret += "Feedback for correct answer: " + stripHtmlTags(data.properties._feedback.correct).replace(/&nbsp;/g, ' ').trim() + "\n\n";
			}
			if (data.properties._feedback._incorrect.final ) {
				ret += "Feedback for incorrect answer: " + stripHtmlTags(data.properties._feedback._incorrect.final).replace(/&nbsp;/g, ' ').trim() + "\n\n";
			}
		} else {
			//Question instruction
			ret += data.properties.instruction + "\n";

			if (data.properties._completionBody) {
				ret += data.properties._completionBody.trim() + "\n";
			}

			//Question items
			try {
				(data.properties._items).forEach(item => {
					if (item.title.trim() != "") {
						ret += item.title.trim() + "\n";
						if (item.body.trim() != "") {
							ret += stripHtmlTags(item.body).replace(/&nbsp;/g, ' ').trim() + "\n\n";
						}
					} else {
						if (item.body.trim() != "") {
							ret += stripHtmlTags(item.body).replace(/&nbsp;/g, ' ').trim() + "\n";
						}
						if (item.text.trim() != "") {
							ret += stripHtmlTags(item.text).replace(/&nbsp;/g, ' ').trim() + "\n";
						}
					}
				});
			} catch (err) {
				//console.log(err);
			}
    	}
	}
	//Feeedback

	return ret;
}

function countWords(text) {
    // Use regular expression to count words
    const wordArray = text.trim().split(/\s+/);
    return wordArray.length;
}

exports.getContentObjectTranscript = async function(req, res, dbo, id) {
    const dbConnect = dbo.getDb();
    try {
        let chunks = [];
        const chunkSize = parseInt(req.query.maxWords) || 10000;
        let currentPage = parseInt(req.query.page) || 1;
        let currentChunk = 0;

        // Fetch the content data from the database
        const data = await buildContentData(dbConnect, id);
        let articles = data.articles;

        // Create text chunks
        chunks[0] = "Module title: " + data.displayTitle.trim() + "\n\n";
		const module = {};
		module.title = data.displayTitle;
		try { module.aim = data._extensions._skillsFramework.aim; } catch (err) {}
		try { module.learningOutcomes = data._extensions._skillsFramework.learningOutcomes; } catch (err) {}
		try { module.reflectiveQuestions = data._extensions._skillsFramework.reflectiveQuestions; } catch (err) {}
        for (let i = 0; i < articles.length; i++) {
            let blocks = articles[i].blocks;
            for (let b = 0; b < blocks.length; b++) {
                let block = blocks[b];
                let components = block.components;
                let question = isQuestion(components);
                let blockText = getElementAsText(block, question);
                for (let c = 0; c < components.length; c++) {
                    let component = components[c];
                    blockText += getElementAsText(component, question);
                }
                if (countWords(chunks[currentChunk] + blockText) <= chunkSize) {
                    chunks[currentChunk] = chunks[currentChunk] + blockText;
                } else {
                    currentChunk += 1;
                    chunks[currentChunk] = "";
                    chunks[currentChunk] = chunks[currentChunk] + blockText;
                }
            }
        }

        const updatedAt = new Date(data.updatedAt);
        const lastModified = updatedAt.toUTCString();

        // Handle the response based on the Accept header
        const acceptHeader = req.headers.accept || 'text/plain';
        if (acceptHeader.includes('application/json')) {
            // Build JSON response containing only the elements included in the text response
            const jsonResponse = [];
            let currentChunkIndex = currentPage - 1;

            for (let i = 0; i < articles.length; i++) {
                let article = articles[i];
                let articleBlocks = [];

                for (let b = 0; b < article.blocks.length; b++) {
                    let block = article.blocks[b];
                    let components = block.components;
                    let blockJson = getElementAsJson(block, isQuestion(components));

                    let blockContent = {
                        block: blockJson,
                        components: components.map(component => getElementAsJson(component, isQuestion([component])))
                    };

                    articleBlocks.push(blockContent);

                    // Add block to the JSON response if it's part of the current chunk
                    if (chunks[currentChunkIndex].includes(getElementAsText(block, isQuestion(components)))) {
                        jsonResponse.push({
							module: module,
                            content: articleBlocks
                        });
                    }
                }
            }

            if (chunks.length > 1) {
                const baseUrl = req.protocol + '://' + req.get('host') + req.baseUrl;
                let nextChunkUrl = `${baseUrl}${req.path}?maxWords=${chunkSize}&page=${currentPage + 1}`;
                res.set('Link', `<${nextChunkUrl}>; rel="next"`);
            }

            res.set('Last-Modified', lastModified);
            res.set('Content-Type', 'application/json');
            res.json(jsonResponse);

        } else {
            // Default to text/plain response
            if (chunks.length > 1) {
                const baseUrl = req.protocol + '://' + req.get('host') + req.baseUrl;
                let nextChunkUrl = `${baseUrl}${req.path}?maxWords=${chunkSize}&page=${currentPage + 1}`;
                res.set('Link', `<${nextChunkUrl}>; rel="next"`);
            }

            res.set('Last-Modified', lastModified);
            res.set('Content-Type', 'text/plain');
            res.send(chunks[currentPage - 1]);
        }
    } catch (err) {
        console.error("Error:", err);
        if (err.message === "Content object not found") {
            res.status(404).json({ error: "Content object not found" });
        } else {
            res.status(500).json({ error: "An error occurred" });
        }
    }
}

exports.getContentObjectOutcomesMetadata = async function(req,res,dbo,id) {
	const dbConnect = dbo.getDb();
	const context = req.query.programme || null;
	try {
		let chunks = [];
		const chunkSize = parseInt(req.query.maxWords) || 10000;
		let currentPage = parseInt(req.query.page) || 1;
		let currentChunk = 0;
		//HERE to get the last updated date (this is all from create 2 so it live to changes! Ideally needs to be from)
	  	const data = await buildContentData(dbConnect, id);
		const courseData = await getObjectById(dbConnect, "course", data._courseId);
		chunks[0] = "Module title: " + data.displayTitle.trim() + "\n\n";
		const updatedAt = new Date(data.updatedAt);
		const lastModified = updatedAt.toUTCString();

		let aim = "Aim: " + stripHtmlTags(data._extensions._skillsFramework.aim).trim() + "\n\n";
		chunks[0] += aim;
		let learningOutcomesText = "Learning outcomes:\n";

		const learningOutcomes = data._extensions._skillsFramework.learningOutcomes;
		for (var i=0;i<learningOutcomes.length;i++) {
			learningOutcomesText += " - " + learningOutcomes[i].outcome + "\n";
		}
		chunks[0] += learningOutcomesText + "\n";

		let reflectiveQuestionsText = "Reflective questions/exercises:\n";
		const reflectiveQuestions = data._extensions._skillsFramework.reflectiveQuestions;
		for (var i=0;i<reflectiveQuestions.length;i++) {
			reflectiveQuestionsText += " - " + reflectiveQuestions[i].question + "\n";
		}
		chunks[0] += reflectiveQuestionsText;
		const programmes = courseData._extensions._skillsFramework._items;
		for (var i=0;i<programmes.length;i++) {
			let programmesText = "\n\nPart of programme: " + programmes[i].title + "\n\n";
			programmesText += "Programme aim: " + stripHtmlTags(programmes[i].aim).trim() + "\n\n";
			programmesText += "Position of module in programme: " + stripHtmlTags(programmes[i].positionDescription).trim() + "\n\n";
			programmesText += "Related programme learning outcomes: \n";
			const programmeLOs = programmes[i].learningOutcomes;
			for (var j=0;j<programmeLOs.length;j++) {
				programmesText += " - " + programmeLOs[j].outcome + "\n";
			}
			programmesText += "\n";
			programmesText += "Programme specific reflective questions for module: \n";
			const programmeReflectiveQuestions = programmes[i].reflectiveQuestions;
			for (var j=0;j<programmeReflectiveQuestions.length;j++) {
				programmesText += " - " + programmeReflectiveQuestions[j].question + "\n";
			}
			if (context) {
				if (programmes[i].uri === context) {
					chunks[0] += programmesText;
				}
			} else {
				chunks[0] += programmesText;
			}
		}

		if (chunks.length > 1) {
			const baseUrl = req.protocol + '://' + req.get('host') + req.baseUrl;
			nextChunkUrl = baseUrl + req.path + "?maxWords=" + chunkSize + "&page=" + (currentPage + 1);
			res.set('Link', `<${nextChunkUrl}>; rel="next"`);
		}

		res.set('Last-Modified', lastModified);
		res.set('Content-Type', 'text/plain');
		res.send(chunks[currentPage-1])
	} catch (err) {
		console.error("Error:", err);
		if (err.message === "Content object not found") {
		  res.status(404).json({ error: "Content object not found" });
		} else {
		  res.status(500).json({ error: "An error occurred" });
		}
	}
}

exports.getContentObjectHead = async function(req, res, dbo, id) {
    const dbConnect = dbo.getDb();

    try {
        // Fetch the data from the database
        const data = await buildContentData(dbConnect, id);

        // Get the last modified date and format it
        const updatedAt = new Date(data.updatedAt);
        const lastModified = updatedAt.toUTCString();

        // Determine the desired content type from the Accept header
        const acceptHeader = req.headers.accept || 'application/json';
        if (acceptHeader.includes('application/json')) {
            // Set content-type to application/json (if needed for other purposes)
            res.setHeader('Content-Type', 'application/json');
        } else {
            // Set content-type to text/plain (if needed for other purposes)
            res.setHeader('Content-Type', 'text/plain');
        }

        // Set the Last-Modified header
        res.setHeader('Last-Modified', lastModified);

        // Send an empty response body with a 200 status
        return res.status(200).send();
    } catch (err) {
        console.error("Error:", err);
        if (err.message === "Content object not found") {
            return res.status(404).json({ error: "Content object not found" });
        } else {
            return res.status(500).json({ error: "An error occurred" });
        }
    }
}

exports.getContentObject = async function(req, res, dbo, id) {
	const dbConnect = dbo.getDb();
	try {
	  const contentData = await buildContentData(dbConnect, id);
	  const updatedAt = new Date(contentData.updatedAt);
	  const lastModified = updatedAt.toUTCString();
	  res.set('Last-Modified', lastModified);
	  res.json(contentData);
	} catch (err) {
	  console.error("Error:", err);
	  if (err.message === "Content object not found") {
		res.status(404).json({ error: "Content object not found" });
	  } else {
		res.status(500).json({ error: "An error occurred" });
	  }
	}
}

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