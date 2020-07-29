require('dotenv').config();

const Discord = require('discord.js');
const textToSpeech = require('@google-cloud/text-to-speech');
// Import other required libraries
const fs = require('fs');
const util = require('util');
// Creates clients
const ttsclient = new textToSpeech.TextToSpeechClient();
const client = new Discord.Client();
const crypto = require('crypto');

client.login(process.env.DISCORD_BOT_TOKEN);

let queue = {};

client.on('ready', () => {
	console.log('announcerbot ready');
});

client.on('message', msg => {
	if (msg.author.bot) return;	
	if (msg.content.substring(0,3) == '!ab'){
		const args = msg.content.slice(3).trim().split(/ +/g);
		const command = args.shift().toLowerCase();
		console.log("command: " + command);
		if (command === "restart")  {
			msg.react("✅");
			console.log("restarting");
			setTimeout(process.exit(), 500); //must be managing the process using PM2 or forever or the shard manager, or something similar or this just ends the program
			//TODO: redo this to actually react to the command before restarting
		} else if (command == "say") {
			if (msg.author.id == process.env.owner)
			{
				msg.react("✅");
				const message = args.join(" ");
				console.log(args);
				console.log(message);
				console.log(msg);
				addToQueue(message, msg.member.voice);
			}
			else {
				msg.react("❌");
			}
			
		} else if (command == "test") {
			msg.react("✅");
			addToQueue("Test", msg.member.voice);
		} else{
			msg.react("❌");
		}
	}

});

function findUserChannel(author) {
}

async function addToQueue(message, voiceState) {
	if (!voiceState.channel.joinable) return; //dont queue for unjoinable channels
	if (voiceState.channel.id === voiceState.guild.afkChannelID) return; //dont queue messages in afk channel
	
	guildID = voiceState.guild.id;
	
	if (queue[guildID] === undefined) {
		queue[guildID] = { 
			queue: [],
			isPlaying: false,
		};
	}
	
    if (!queue[guildID].isPlaying) {
        queue[guildID].isPlaying = true;
		
		
		const connection = await voiceState.channel.join();

		console.debug('playing: ' + message);
        readyAnnouncementFile(message, (err, filePath) => {
            if (err) {
                console.error(err);
                return;
            }

            console.debug('queueing message: ' + message);
			const discordStream = connection.play(filePath); 
			
			//console.debug('played' + message);
			
			discordStream.on('start', () =>{
				console.debug('started playing');

			});
			
			discordStream.on('finish', reason =>{	
				queue[guildID].isPlaying = false;
				if (queue[guildID].queue.length) {
					addToQueue(...Object.values(queue[guildID].queue.shift()));
				} else {
					//if bot is alone in channel
					console.debug(voiceState.channel.members.size + ' users in channel');
					if(voiceState.channel.members.size < 2){
						connection.disconnect(); // leave
					}
				}
			
				console.debug('finished playing');
			});
			discordStream.on('error', console.error);
        });
    } else {
        queue[guildID].queue.push({ message, voiceState});
    }
}


function writeNewSoundFile(filePath, content, callback) {
    fs.mkdir('./cache/', (err) => fs.writeFile(filePath, content.audioContent, 'binary', (err) => callback(err)));
}

function callVoiceRssApi(message, filePath, callback) {
    console.debug("Making API call");
    let params = {};
	params.request = {
      input: {text: message},
      // Select the language and SSML voice gender (optional)
      voice: {languageCode: process.env.VOICE_LANGUAGE, name: process.env.VOICE_NAME, ssmlGender: process.env.VOICE_GENDER},
      // select the type of audio encoding
      audioConfig: {audioEncoding: 'OGG_OPUS'}, //may want to add pitch and speaking rate options in .env file
    };
	
    params.callback = (err, content) => {
        if (err) {
            callback(err);
        }
        writeNewSoundFile(filePath, content, (err) => {
            callback(err);
        });
    }
    speech(params);
};

function readyAnnouncementFile(message, callback) {
	//console.debug('readyFile');
	
	const fileName = crypto.createHash('md5').update(message.toLowerCase()).digest('hex') + '.ogg';
    const filePath = "./cache/" + fileName;

    fs.stat(filePath, (err) => {
		//console.debug('check file');
		console.debug("playing/creating file " + filePath);
        if (err && err.code == 'ENOENT') {
            callVoiceRssApi(message, filePath, (err) => callback(err, filePath));
            return;
        }

        callback(err, filePath);
    });
}

async function speech(params){
	//console.debug('speech');
	//console.debug(params.request);
	
	const [response] = await ttsclient.synthesizeSpeech(params.request);

	if (params.callback) {
		params.callback(null, response);
	}
}

function getUserName(guildMember){
	return (guildMember.nickname || guildMember.user.username);
}

client.on('voiceStateUpdate', async (oldState, newState) => {
	var oldMember = oldState.member;
	var newMember = newState.member;
  	
	if (newMember.id != client.user.id){ //ignore myself
		if (oldState.channel === null && newState.channel  !== null){ //if not previously connected to a channel
			console.debug('-----joined ' + newState.channel.name + '-----');
			addToQueue(getUserName(newMember) + " joined the channel", newState);
			return;
		} else if (oldState.channel !== null && newState.channel  === null){ //if disconnect
			console.debug('-----left ' + oldState.channel.name + '-----');
			addToQueue(getUserName(oldMember) + " left the channel", oldState);
			return;
		} else if (oldState.channel != newState.channel){ //if changed channel
			console.debug('-----changed channel-----');
			console.debug('from ' + oldState.channel.name + ' to ' + newState.channel.name); 
			
			addToQueue(getUserName(oldMember) + " left the channel", oldState);
			
			addToQueue(getUserName(newMember) + " joined the channel", newState); 
			
			return;
		} else {
			console.debug('-----here be dragons-----');
		}
	}
});
