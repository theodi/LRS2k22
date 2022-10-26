const { MongoClient } = require("mongodb");
const connectionString = process.env.AAT_URI;
const database = process.env.AAT_DB;
const client = new MongoClient(connectionString, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

let dbConnection;

module.exports = {
  connectToServer: function (callback) {
    client.connect(function (err, db) {
      if (err || !db) {
        return callback(err);
      }

      dbConnection = db.db(database);
      console.log("Successfully connected to Adapt AAT MongoDB.");

      return callback();
    });
  },

  getDb: function () {
    return dbConnection;
  },
};