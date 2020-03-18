require('dotenv').config();

const Discord = require('discord.js');
//const ytdl = require('ytdl-core');
const lowdb = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const textToSpeech = require('@google-cloud/text-to-speech');
// Import other required libraries
const fs = require('fs');
const util = require('util');
// Creates a client
const ttsclient = new textToSpeech.TextToSpeechClient();


const client = new Discord.Client();

client.login(process.env.DISCORD_BOT_TOKEN);

const db = lowdb(new FileSync('db.json'));

db.defaults({
    users: {},
}).write();

const commands = {
    welcome(message) {
        const user = message.mentions.members.first();
        const [, link] = /^(?:\/welcome <.+>) (.+)/.exec(message.content) || [];

        if (link) {
            db.get('users').assign({
                [user.id]: link,
            }).write();

            message.delete();
        }
    },
};

function routeMessage(message) {
    const command = Object.keys(commands)
        .find(command => new RegExp(`\/${command}`).test(message.content));

    if (command) {
        commands[command](message);
    }
}

client.on('message', routeMessage);

let queue = [];
let isPlaying = false;

async function addToQueue(message, voiceChannel, id) {
    if (!isPlaying) {
        isPlaying = true;

        queue = queue.filter(({ id: idToRemove }) => id !== idToRemove);
		
        const connection = await voiceChannel.join();

        //const youtubeStream = ytdl(soundEffect, { filter: 'audioonly' });
		const path = util.promisify(getTTS);
		
		console.log('playing' + message);
        const discordStream = connection.play(await path(message)); // gets stuck here
		console.log('played' + message);
		
        discordStream.on('end', reason => {
            if (reason) {
                isPlaying = false;
                if (queue.length) {
                    addToQueue(...Object.values(queue.shift()));
                } else {
					//if bot is alone in channel
                   // connection.disconnect(); // leave
                }
            }
        }); 
    } else {
        queue.push({ message, voiceChannel, id });
    }
}

async function getTTS(textts) {

	//remove non alphanumeric characters and make it lower case
	textts = textts.replace(/[^0-9a-z\s]/gi, '');
	textts = textts.toLowerCase();
	// Construct the request


	// Performs the text-to-speech request if file doesn't exist
	await fs.access('cache/'+textts+'.mp3', fs.F_OK, (err) => {
		if (err){
			makeTTS(textts);
		}
		console.log('checking ./cache/'+textts+'.mp3');
		return ('./cache/'+textts+'.mp3');
	});
}

async function makeTTS(message) {
	
    // Construct the request
    const request = {
      input: {text: message},
      // Select the language and SSML voice gender (optional)
      voice: {languageCode: process.env.VOICE_LANGUAGE, name: process.env.VOICE_NAME, ssmlGender: process.env.VOICE_GENDER},
      // select the type of audio encoding
      audioConfig: {audioEncoding: 'MP3'},
    };

    // Performs the text-to-speech request
    const [response] = await ttsclient.synthesizeSpeech(request);
    // Write the binary audio content to a local file
    const writeFile = util.promisify(fs.writeFile);
    await writeFile('cache/'+message+'.mp3', response.audioContent, 'binary');
    console.log('Audio content written to file: '+message+'.mp3');
}

function getUserName(guildMember){
	return (guildMember.nickname || guildMember.user.username);
}


client.on('voiceStateUpdate', async (oldState, newState) => {
	var oldMember = oldState.member;
	var newMember = newState.member;
	//	console.log(oldMember);
	//	console.log(newMember);
	if (oldMember.id != 689317722374668299 || newMember.id != 689317722374668299){
		const { voiceChannel: newUserChannel } = newMember;
		const { voiceChannel: oldUserChannel } = oldMember;

		if(oldUserChannel === undefined && newUserChannel !== undefined) {
			addToQueue(getUserName(newMember), newMember.voice.channel);
			addToQueue("has joined the channel", newMember.voice.channel);
		} else if (newUserChannel === undefined) {
			addToQueue(getUserName(oldMember), oldMember.voice.channel);
			addToQueue("has left the channel", oldMember.voice.channel);
		}
	}
});
