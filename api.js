const fetch = require('node-fetch');
var json2csv = require('json2csv'); // Library to create CSV for output
const { Headers } = fetch;

resolved = false;
promises = [];

/*
 * execQuery (query)
 * 
 * Take a raw query and exec it against the Learning Locker Endpoint
 * Writen to support the use of pagination using MORE
 * 
 * REUSABLE
 */
const execQuery = async (query) => {
    let myHeaders = new Headers();
    myHeaders.append(
        'Authorization',
        'Basic ' + process.env.LEARNING_LOCKER_KEY
    );
    myHeaders.append('Content-Type', 'application/json');
    myHeaders.append('X-Experience-API-Version', '1.0.0');

    let requestOptions = {
        method: 'GET',
        headers: myHeaders,
        redirect: 'follow',
    };
    // get paramters from search param in url

    let base = "https://theodi.learninglocker.net";
    query = base + query;

    const getJson = async (query) => {
        try {
            const res = await fetch(
                query,
                requestOptions
            );
            return await res.json();
        }
        // catch error and return 404 to user 
        catch (error) {
            res.statusMessage = "Internal server error";
            res.status(500).end();
            res.send();
            return;
        }
    };
    return await getJson(query);
}

/*
 * getStatements
 * 
 * Function to get the results of the first query
 * Subsequenct calls to execQuery should come from the pagination (MORE) returned in the result
 * 
 * REUSABLE
 */
const getStatements = async (activity, verb, since, until, related_activities) => {
    let base = "/data/xAPI/statements?";
    let args = [];
    if (verb) { args.push("verb=" + verb); }
    if (activity) { args.push("activity=" + encodeURIComponent(activity)); }
    if (since) { args.push("since=" + since); }
    if (until) { args.push("until=" + until); }
    if (related_activities) { args.push("related_activities=true"); }
    var query = base + args.join('&');

    return await execQuery(query);
}

/*
 * simplifyOutput
 *
 * Takes the aggregated results from a set of results related to a question and creates an output suitable for rendering in ChartJS
 *
 * VERY SPECIFIC to aggregate queries about a question and to ChartJS
 */
function simplifyOutput(input) {
    var array = [];
    input.map((a) => {
        array.push(a.Count);
    });
    return array;
}

/* 
 * getCombinedProgress (existingProgress, newProgress)
 *
 * When handling a paginated set of statements, you may get multiple results about an actor contain the progress object and these need combining into one.
 * This is particularly the case for sessionTime when the session will be launched, initialised etc etc etc lots of times. 
 * To work out total session time you need all of these statements.
 *
 * REUSABLE
 */
function getCombinedProgress(eProg,nProg) {
    for (const [key, value] of Object.entries(eProg)) {
        if (nProg[key]) {
            eProg[key] = [...eProg[key],...nProg[key]];
        } 
    }
    return {...nProg,...eProg};
}

/* 
 * getNestedActors 
 *
 * Another function to work with multiple pages of actor results to combine the data together
 *
 * REUSABLE when you have actors as the primary object
 */
const getNestedActors = (arr) => {
    var combined = {};
    for (var i=0; i<arr.length;i++) {
        actors = arr[i].actors;
        for (const [key, value] of Object.entries(actors)) {
            if (combined[key]) {
                combined[key].progress = getCombinedProgress(combined[key].progress,actors[key].progress);
            } else {
                combined[key] = value;
            }
        }
    }
    return combined;
}

/* 
 * getNestedObjects 
 * 
 * When working with multiple pages of results, we only want to return one set of objects. 
 * This function ensure there is one (and only one) copy of each object in the returned data.
 * 
 * REUSABLE
 */
const getNestedObjects = (arr) => {
    var combined = {};
    for (var i=0; i<arr.length;i++) {
        objects = arr[i].objects;
        for (const [key, value] of Object.entries(objects)) {
            if (combined[key]) {
                // IGNORE and continue;
            } else {
                combined[key] = value;
            }
        }
    }
    return combined;
}

/* 
 * getSessionTime (sortedList)
 * 
 * Takes a sorted list of session events and works out the total time spent on an activity
 * If the session is currently open then this time won't be included.
 *
 * REUSABLE with catculateSessionTimes
 */
function getSessionTime(sortedList) {
    var paused = false;
    var lastTime = null;
    var timeSpent = 0;
    for (var i=0;i<sorted.length;i++) {
      verb = sorted[i].verb;
      timestamp = sorted[i].timestamp;
      if (verb == "http://adlnet.gov/expapi/verbs/launched" || verb == "http://adlnet.gov/expapi/verbs/resumed" || verb == "http://adlnet.gov/expapi/verbs/initialized") {
        paused = false;
        lastTime = timestamp;
      }
      if (verb == "http://adlnet.gov/expapi/verbs/suspended" || verb == "http://adlnet.gov/expapi/verbs/terminated") {
        if (!paused && lastTime) {
          timeSpent += new Date(timestamp) - new Date(lastTime);
          lastTime = null;
        }
      }
    }
    return Math.round(timeSpent / 1000);
}

/*
 * calculateSessionTimes(objects)
 * 
 * Takes a set of actor objects (with progress) and adds a new key to the returned data (timeSpentSeconds) that represents the total time spent on the activity
 *
 * REUSABLE
 */
function calculateSessionTimes(objects) {
    for (const [key, value] of Object.entries(objects)) {
        var sessionTime = value.progress.sessionTime;
        sorted = sessionTime.sort(
            (objA, objB) => new Date(objA.timestamp) - new Date(objB.timestamp),
        );
        objects[key].timeSpentSeconds = getSessionTime(sorted);
    }
    return objects;
}

/* 
 * processReturn
 * 
 * Outputs the data in the desired format
 * NOTE: HTML should be removed from here and handled outside of the API handler
 *
 * REUSABLE
 */
function processReturn(req,res,filter,output,csvOutput) {
    
    // Work out what the client asked for, the ".ext" specified always overrides content negotiation
    ext = req.params["ext"] || filter.format;

    // If there is no extension specified then manage it via content negoition, yay!
    if (!ext) {
        ext = req.accepts(['json', 'csv', 'html']);
    }
    // Return the data to the user in a format they asked for
    // CSV, JSON or by default HTML (web page)
    res.set('Access-Control-Allow-Origin', '*');
    if (ext == "csv") {
        res.set('Content-Type', 'text/csv');
        res.send(json2csv({ data: csvOutput }));
    } else if (ext == "json") {
        res.set('Content-Type', 'application/json');
        res.send(JSON.stringify(output, null, 4));
    } else if (ext == "chartjs") {
        res.set('Content-Type', 'text/plain');
        res.send(JSON.stringify(simplifyOutput(csvOutput), null, 4));
    } else {
        res.set('Content-Type', 'application/json');
        res.send(JSON.stringify(output, null, 4));
    }
}

/*
 * makeActivityDataCSVOutput (output)
 *
 * Takes the output from the getActivityData and creates an object that can be output as a CSV file
 * Specific to the getActivityData API call
 *
 * NOT REUSABLE as each CSV has a different structure
 */
function makeActivityDataCSVOutput(output) {
    var csvOutput = [];
    for (const [actorid, data] of Object.entries(output.actors)) {
        var item = {};
        item.actor = actorid;
        item.name = data.name || "";
        item.mbox = data.mbox || "";
        item.timeSpentSeconds = data.timeSpentSeconds || "";
        for (const [activityid, progressdata] of Object.entries(data.progress)) {
            if (progressdata[0].verb != "sessionTime") {
                item[activityid] = progressdata[0].verb;
            }
        }
        csvOutput.push(item);
    }
    return csvOutput;
}

/*
 * processActivityDataObjects
 * 
 * Specific function to build the data required for the getActivityData API call
 * This function is required to call itself to process additional pages
 *
 * NOT REUSABLE
 */
function processActivityDataObjects(objects,activity,related_activities) {
        var output = {};
        console.log("Processing objects");
        if (!objects) {
            res.statusMessage = "Internal server error";
            res.status(500).end();
            res.send();
            return;
        }
        if (objects.more) {
            console.log("Adding promise to the array");
            promises.push(new Promise((resolve,reject) => {
                execQuery(objects.more).then((objects) => {
                    resolve(processActivityDataObjects(objects,activity,related_activities));
                });
            }));
        } else {
            resolved = true;
        }
        
        var statements = objects.statements;
        if (statements.length < 1 || !statements) {
            res.statusMessage = "No data found for activity " + activity + " with verb " + verb;
            res.status(404).end();
            res.send();
            return;
        }

        if (!related_activities) {
            output.object = statements[0].object;
        } else {
            output.objects = {};
        }
        output.actors = {};

        try {
            statements.map((a) => {
                actorid = a.actor.account.name;
                objectid = a.object.id;
                if (related_activities && !output.objects[objectid]) {
                    output.objects[objectid] = a.object;    
                }
                if (!output.actors[actorid]) {
                    output.actors[actorid] = a.actor;
                    progress = {};
                } else {
                    progress = output.actors[actorid].progress;
                }
                verb = a.verb.id;
                if(objectid == activity) {
                    if (verb == "http://adlnet.gov/expapi/verbs/passed") {
                        objectid = "passed";
                    } else if (verb == "http://adlnet.gov/expapi/verbs/completed") {
                        objectid = "completed";
                    } else { 
                        objectid = "sessionTime";
                    }
                }
                if (!progress[objectid]){
                    progress[objectid] = [];
                    statement = {};
                    statement.verb = a.verb.id;
                    statement.timestamp = a.timestamp;
                    progress[objectid].push(statement);
                } else {
                    statement = {};
                    statement.verb = a.verb.id;
                    statement.timestamp = a.timestamp;
                    progress[objectid].push(statement);
                }
                output.actors[actorid].progress = progress;
            });
        } catch (error) {
            console.log(error);
            output.success = "unknown";
            output.completion = "unknown";
        }
        return output;
}

/* 
 * combineQuestionSummaryResults 
 * 
 * When working with multiple pages of results, we only want to return one set of objects. 
 * This function adds up all the counts for the question summary results including completion and success measures
 * 
 * NOT REUSABLE
 */
const combineQuestionSummaryResults = (arr) => {
    var combined = {};
    var output = {};
    output.responses = [];
    output.success = 0;
    output.completion = 0;
    for (var i=0; i<arr.length;i++) {
        responses = arr[i].responses;
        for (j=0;j<responses.length;j++) {
            if (!combined[responses[j].id]) {
                combined[responses[j].id] = 0;
            } 
            combined[responses[j].id] += responses[j].count;
        }
        output.success += arr[i].success;
        output.completion += arr[i].completion;
    }
    for (const [key, value] of Object.entries(combined)) {
        var local = {};
        local.id = key;
        local.count = value;
        output.responses.push(local);
    }

    return output;
}

/*
 * makeQuestionDataCSVOutput (output)
 *
 * Takes the output from getQuestionSummaryData and creates an object that can be output as a CSV file
 * Specific to the getQuestionSummaryData API call
 * CSV has two columns:
 *   Answer: English text of the answer
 *   Count: Number of people who picked this response
 *
 * NOT REUSABLE as each CSV has a different structure
 */
function makeQuestionDataCSVOutput(output) {
    var choices = output.object.definition.choices;
    var rotated_choices = {};

    var responses = output.responses;

    var output = [];
    
    for (i=0;i<choices.length;i++) {
        rotated_choices[choices[i].id] = choices[i].description.en;
    }

    for (i=0;i<responses.length;i++) {
        id = responses[i].id;
        var local = {};
        local.Answer = rotated_choices[id];
        local.Count = responses[i].count;
        output.push(local);
    }
    return output;
}

/*
 * processQuestionDataObjects
 * 
 * Specific function to build the data required for the getQuestionSummaryData API call
 * This function is required to call itself to process additional pages
 *
 * NOT REUSABLE
 */
function processQuestionDataObjects(objects) {
    var statements = objects.statements;

    console.log("Processing objects");
    if (!objects) {
        res.statusMessage = "Internal server error";
        res.status(500).end();
        res.send();
        return;
    }

    if (objects.more) {
        console.log("Adding promise to the array");
        promises.push(new Promise((resolve,reject) => {
            execQuery(objects.more).then((objects) => {
                resolve(processQuestionDataObjects(objects));
            });
        }));
    } else {
        resolved = true;
    }
    
    var output = {};

    output.object = statements[0].object;
    output.responses = [];
    output.success = 0;
    output.completion = 0;

    var responseArray = [];
    try {
        statements.map((a) => {
            result = a.result;
            responses = result.response.split('[,]');
            responses.map((response) => {
                if (responseArray[response]) {
                    responseArray[response] += 1;
                } else {
                    responseArray[response] = 1;
                }
            });
            if (result.success) { output.success += 1; }
            if (result.completion) { output.completion += 1; }
        });
    } catch (error) {
        output.success = "unknown";
        output.completion = "unknown";
    }
    try {
        statements[0].object.definition.choices.map((a) => {
            let jsonres = {};
            jsonres.id = a.id;
            jsonres.count = responseArray[a.id] || 0;
            output.responses.push(jsonres);
        });
    } catch (error) {
        // Do nothing
    }
    return output;
}

/* 
 * getActivityData
 * 
 * Get actor level data about interactions with an activity an all it's related objects.
 * You call this API with an activity ID which represents a page or module and it will return all related (e.g. child) activities. 
 * In simple terms the returned data will be in the form of one row per actor and one column per activity with some added extras including sessionTime.
 * 
 * SPECIFIC API function.
 * Example API call = http://localhost:3080/api/activityData?activity=https://theodi.stream.org/xapi/activities/learning-lockker-stand-alone-xapi-test-dt
 */
exports.getActivityData = function(req, res) {
    resolved = false;
    promises = [];
    var filter = req.query;
    if (!filter.activity) {
        res.statusMessage = "You need to define an activity e.g. http://url.com/?activity=http://....";
        res.status(400).end();
        res.send();
        return;
    }

    var activity = filter.activity;
    var verb = filter.verb || null;
    var since = filter.since || null;
    var until = filter.until || null;
    var related_activities = filter.related_activities || true;
    var format = filter.format;

    getStatements(activity, verb, since, until, related_activities).then((objects) => {
        promises.push(new Promise((resolve,reject) => {
            resolve(processActivityDataObjects(objects,activity,related_activities));
        }));
        var resolve = setInterval(() => {
            if (resolved == true) {
                clearInterval(resolve);
                Promise.all(promises).then((values) =>{
                    var output = {};
                    console.log("All promises returned");
                    output.actors = calculateSessionTimes(getNestedActors(values));
                    output.objects = getNestedObjects(values);
                    console.log("done processing");
                    processReturn(req,res,filter,output,makeActivityDataCSVOutput(output)); 
                });
            }
        },100);
    });
}

/* 
 * getQuestionSummaryData
 * 
 * Get anonymous aggregated data about interactions with a single question. 
 * You call this API with an activity ID which represents a question which can be marked with the answered verb in XAPI.
 * In simple terms the returned data will be in the form of the question object and how many people answered with each option. 
 * In the JSON format you also get how many completions and how many were successful as well as a defintion of the object itself.
 * 
 * SPECIFIC API function.
 * Example API call = http://localhost:3080/api/questionSummary?activity=activity=https://learning.theodi.org/xapi/activities/mit-moral-machine-test%23/id/630f81656b4097008b2afd6f_branching_0
 */
exports.getQuestionSummaryData = function(req, res) {
    resolved = false;
    promises = [];
    var filter = req.query;
    if (!filter.activity) {
        res.statusMessage = "You need to define an activity e.g. http://url.com/?activity=http://....";
        res.status(400).end();
        res.send();
        return;
    }

    var activity = filter.activity;
    var verb = "http://adlnet.gov/expapi/verbs/answered";
    var since = filter.since || null;
    var until = filter.until || null;
    var related_activities = filter.related_activities || false;
    var format = filter.format;
    
    getStatements(activity, verb, since, until, false).then((objects) => {
        if (!objects) {
            res.statusMessage = "Internal server error";
            res.status(500).end();
            res.send();
            return;
        }
        promises.push(new Promise((resolve,reject) => {
            resolve(processQuestionDataObjects(objects,activity,related_activities));
        }));
        var resolve = setInterval(() => {
            if (resolved == true) {
                clearInterval(resolve);
                Promise.all(promises).then((values) =>{
                    var output = {};
                    console.log("All promises returned");
                    output = combineQuestionSummaryResults(values);
                    output.object = values[0].object;
                    console.log("done processing");
                    processReturn(req,res,filter,output,makeQuestionDataCSVOutput(output));
                });
            }
        },100);
    });
}
