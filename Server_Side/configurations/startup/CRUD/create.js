/*eslint-env node */

var request = require('request');
var reload = require('require-reload')(require),
    configFile = reload(__dirname+'/../../configuration.js'),
	participants = reload(__dirname+'/../../../blockchain/participants/participants_info.js');
var tracing = require(__dirname+'/../../../tools/traces/trace.js');	
var spawn = require('child_process').spawn;
var fs = require('fs');
var crypto = require('crypto');

var send_error = false;
var counter = 0;
var innerCounter = 0;
var users = [];

var connectorInfo;

var create = function(dataSource)
{
	
	connectorInfo = dataSource
	
	console.log("Creating and registering users");
	
	participants = reload(__dirname+"/../../../blockchain/participants/participants_info.js");
	
	if(participants.participants_info.hasOwnProperty('regulators'))
	{
		var data = participants.participants_info;
		
		for(var key in data)
		{
			if(data.hasOwnProperty(key))
			{
				for(var i = 0; i < data[key].length; i++)
				{
					users.push({"type":key,"identity":data[key][i].name});
				}
			}
		}
		addUser()
	}
	else
	{
		tracing.create('ERROR', 'GET blockchain/participants', 'Participants file not found');
		var error = {}
		error.error = true;
		error.message = 'Participants information not found';
		return JSON.stringify({"message":"Participants information not found","error":true})
	}
}

function addUser()
{
		
	var userAff = "0000";

	switch (users[counter].type) {
			case "regulators": 
				userAff = "0001";
				break;
			case "manufacturers":
				userAff = "0002";
				break;
			case "dealerships":
				userAff = "0003";
				break;
			case "lease_companies":
				userAff = "0004";
				break;
			case "leasees":
				userAff = "0003";
				break;
			case "scrap_merchants":
				userAff = "0005";
				break;
	}

	var options = 	{
						url: configFile.config.api_ip+':'+configFile.config.api_port_external+'/registrar/'+users[counter].identity,
						method: "GET", 
						json: true
					}
	
	request(options, function(error, response, body)
	{	
		if(body.hasOwnProperty("OK"))
		{
			if(counter < users.length - 1)
			{
				counter++;
				console.log("Created and registered user:",users[counter].identity);
				setTimeout(function(){addUser()}, 2000);
			}
			else
			{
				counter = 0;
				console.log("Created and registered user:",users[counter].identity);
				deploy_vehicle();
			}
			
		}
		else
		{
			
			var result = createUser(users[counter].identity, 1, userAff)
			console.log("create user result",result)
			
			if (result) {
				if(counter < users.length - 1)
				{
					counter++;
					console.log("Created and registered user:",users[counter].identity);
					setTimeout(function(){addUser();},1000);
				}
				else
				{
					counter = 0;
					console.log("Created and registered user:",users[counter].identity);
					deploy_vehicle();
				}
			}
			else
			{
				
				console.log("LOGGING IN BIG ERROR")
				
				tracing.create('ERROR', 'POST admin/identity', 'Unable to log user in: '+users[counter].identity);
				var error = {}
				error.message = 'Unable to register user: '+users[counter].identity;
				error.error = false;
				console.log(JSON.stringify(error));
				if(counter < users.length - 1)
				{
					counter++;
					setTimeout(function(){addUser()}, 500);
				}
				else
				{
					deploy_vehicle();
				}
			}

		}
	})
}

function deploy_vehicle()
{

	var api_url = configFile.config.api_ip+":"+configFile.config.api_port_internal
	    api_url = api_url.replace('http://', '')
	    
    var randomVal = crypto.randomBytes(256).toString('hex')
	
				
	var deploySpec = {
						  "jsonrpc": "2.0",
						  "method": "deploy",
						  "params": {
						    "type": 1,
						    "chaincodeID": {
						      "path": configFile.config.vehicle
						    },
						    "ctorMsg": {
						      "function": "init",
						      "args": [
						        api_url, randomVal
						      ]
						    },
						    "secureContext": "DVLA"
						  },
						  "id": 12
						}
									
	var options = 	{
						url: configFile.config.api_ip+":"+configFile.config.api_port_external+'/chaincode',
						method: "POST", 
						body: deploySpec,
						json: true
					}
	
	request(options, function(error, response, body)
	{
		
		console.log("VEHICLE DEPLOY RESPONSE",body)
		
		if (!body.hasOwnProperty('error') && response.statusCode == 200)
		{
			
			update_config(body.result.message)
			
			var interval = setInterval(function(){
				
				var options = 	{
						url: configFile.config.api_ip+':'+configFile.config.api_port_external+'/chain',
						method: "GET",
						json: true
					}
					
				request(options, function(error, response, body){
					console.log("Polling height",body.height)
					if(body.height >= 2){
						console.log("Height is now big enough")
						clearInterval(interval)
					}
				});	
			}, 2000)
		}
		else
		{
			
			return JSON.stringify({"message":"Error deploying vehicle chaincode","body":body,"error":true})
		}
	})
}

function createUser(username, role, aff)
{
	
	if (!connectorInfo.connector) {
		return JSON.stringify({"message":"Cannot register users before the CA connector is setup!", "error":true});
	}

	// Register the user on the CA
	var user = {
		"identity": username,
		"role": role,
		"account": "group1",
		"affiliation": aff
	}
	 
	connectorInfo.connector.registerUser(user, function (err, response) {
		if (err) {
			
			if(innerCounter >= 5){
				innerCounter = 0;
				console.error("RegisterUser failed:", username, JSON.stringify(err));
			}
			else{
				innerCounter++
				console.log("Trying again", innerCounter);
				setTimeout(function(){createUser(username,role,aff);},2000)	            
			}

		} else {
			
			innerCounter = 0;
			
			console.log("RegisterUser succeeded:", JSON.stringify(response));
			// Send the response (username and secret) for logging user in 
			var creds = {
				id: response.identity,
				secret: response.token
			};
			loginUser(username, aff, creds.secret);
			
			return
			
		}
	});	
}

function loginUser(username, aff, secret)
{
	
	configFile = reload(__dirname+'/../../configuration.js');
	var credentials = {
						  "enrollId": username,
						  "enrollSecret": secret
						}
	
	var options = 	{
						url: configFile.config.api_ip+':'+configFile.config.api_port_external+'/registrar',
						method: "POST", 
						body: credentials,
						json: true
					}
					
	request(options, function(error, response, body){
		if (!body.hasOwnProperty("Error") && response.statusCode == 200)
		{
			innerCounter = 0;
			console.log("LOGIN SUCCESSFUL", username)
			writeUserToFile(username, secret)
			return true
		}
		else
		{
			if(innerCounter >= 5){
				innerCounter = 0;
				return false
			}
			else{
				innerCounter++
				console.log("Trying logging in again", innerCounter);
				setTimeout(function(){loginUser(username, aff, secret);},2000)	            
			}
			
		}
	});
}

function update_config(name)
{

	configFile = reload(__dirname+'/../../configuration.js');
	fs.readFile(__dirname+'/../../configuration.js', 'utf8', function (err,data)
	{
		if (err)
		{
			console.log("Read file error", err)
			return false
		}

		var toMatch = "config.vehicle_name = '"+ configFile.config.vehicle_name+"';"
		var re = new RegExp(toMatch, "g")

		var result = data.replace(re, "config.vehicle_name = '"+name+"';");

		fs.writeFileSync(__dirname+'/../../configuration.js', result, 'utf8', function (err)
		{
			if (err)
			{	
				return false
			}
			else
			{
				return true
			}			
		});
	});
}


function writeUserToFile(username, secret)
{
	participants = reload(__dirname+'/../../../blockchain/participants/participants_info.js');
	
	var userType = "";
	var userNumber = "";
	
	for(var k in participants.participants_info)
	{
		if (participants.participants_info.hasOwnProperty(k)) 
		{
			
           var data = participants.participants_info[k];
           for(var i = 0; i < data.length; i++)
           {
           		
	       		if(data[i].identity == username)
	       		{
	       			userType = k;
	       			userNumber = i;
	       			break;
	       		}
           }
        }
	}
	
	var newData = participants.participants_info;
	newData[userType][userNumber].password = secret;
	
	var updatedFile = '/*eslint-env node*/\n\nvar user_info = JSON.parse(process.env.VCAP_SERVICES)["ibm-blockchain-5-prod"][0]["credentials"]["users"];\n\nvar participants_info = '+JSON.stringify(newData)+'\n\nexports.participants_info = participants_info;';
	
	fs.writeFileSync(__dirname+'/../../../blockchain/participants/participants_info.js', updatedFile);
}

exports.create = create;