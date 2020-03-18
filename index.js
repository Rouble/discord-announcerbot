require('dotenv').config();

const Discord = require('discord.js');
const FileSync = require('lowdb/adapters/FileSync');
const textToSpeech = require('@google-cloud/text-to-speech');
// Import other required libraries
const fs = require('fs');
const util = require('util');
// Creates a client
const ttsclient = new textToSpeech.TextToSpeechClient();


const client = new Discord.Client();

client.login(process.env.DISCORD_BOT_TOKEN);



let queue = [];
let isPlaying = false;

async function addToQueue(message, voiceChannel, id) {
    if (!isPlaying) {
        isPlaying = true;

        queue = queue.filter(({ id: idToRemove }) => id !== idToRemove);
		
        const connection = await voiceChannel.join();

        //const youtubeStream = ytdl(soundEffect, { filter: 'audioonly' });
		//getTTS(message);
		
		console.log('playing' + message);
        //const discordStream = readyAnnouncementFile(message, connection.play); // gets stuck here
        readyAnnouncementFile(message, (err, filePath) => {
            if (err) {
                console.error(err);
                return;
            }

            console.log('queueing message: ' + message);
			const discordStream = connection.play(filePath); // gets stuck here
			
			console.log('played' + message);
			
			
			discordStream.on('start', () =>{
				console.log('started playing');
			});
			discordStream.on('finish', reason =>{
				
				isPlaying = false;
				if (queue.length) {
					addToQueue(...Object.values(queue.shift()));
				} else {
					//if bot is alone in channel
					console.log(voiceChannel.members.size + ' users in channel');
					if(voiceChannel.members.size < 2){
						connection.disconnect(); // leave
					}
				}
			
				console.log('finish ' + reason);
			});
			discordStream.on('error', console.log);
        });
    } else {
        queue.push({ message, voiceChannel, id });
    }
}

function writeNewSoundFile(filePath, content, callback) {
    fs.mkdir('./cache/', (err) => fs.writeFile(filePath, content.audioContent, 'binary', (err) => callback(err)));
}

function callVoiceRssApi(message, filePath, callback) {
    console.log("Making API call");
    let params = {};
	params.request = {
      input: {text: message},
      // Select the language and SSML voice gender (optional)
      voice: {languageCode: process.env.VOICE_LANGUAGE, name: process.env.VOICE_NAME, ssmlGender: process.env.VOICE_GENDER},
      // select the type of audio encoding
      audioConfig: {audioEncoding: 'OGG_OPUS'},
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
	console.log('readyFile');
	
	const fileName = message.replace(/[^0-9a-z\s]/gi, '').toLowerCase() + '.ogg';
    const filePath = "./cache/" + fileName;

    fs.stat(filePath, (err) => {
		console.log('check file');
		console.log(filePath);
        if (err && err.code == 'ENOENT') {
            callVoiceRssApi(message, filePath, (err) => callback(err, filePath));
            return;
        }

        callback(err, filePath);
    });
}

async function speech(params){
	console.log('speech');
	console.log(params.request);
	
	const [response] = await ttsclient.synthesizeSpeech(params.request);
	console.log(response);
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

	if (newState && newState.channel && oldState && oldState.channel) {
        if (newState.channel.id == oldState.channel.id) {
        // return; //user hasn't moved don't say anything 
        } 
	}
  
	if (oldMember.id != 689317722374668299 || newMember.id != 689317722374668299){ //ignore myself
		
		if (oldState.channel === null && newState.channel  !== null){ //if not previously connected to a channel
			console.log('-----joined channel-----');
			addToQueue(getUserName(newMember), newState.channel);
			addToQueue("has joined the channel", newState.channel);
			return;
		} else if (oldState.channel !== null && newState.channel  === null){ //if disconnect
			console.log('-----left server-----');
			addToQueue(getUserName(oldMember), oldState.channel);
			addToQueue("has left the channel", oldState.channel);
			return;
		} else if (oldState.channel != newState.channel){ //if changed channel
			console.log('-----change channel-----');
			addToQueue(getUserName(newMember), newState.channel);
			addToQueue("has joined the channel", newState.channel);
			addToQueue(getUserName(oldMember), oldState.channel);
			addToQueue("has left the channel", oldState.channel);
			return;
		} else {
			console.log('-----here be dragons-----');
		}

	}
});
