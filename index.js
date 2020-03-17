require('dotenv').config();

const Discord = require('discord.js');
const ytdl = require('ytdl-core');
const lowdb = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const textToSpeech = require('@google-cloud/text-to-speech');


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
        const discordStream = connection.play(getTTS(message));

        discordStream.on('end', reason => {
            if (reason) {
                isPlaying = false;
                if (queue.length) {
                    addToQueue(...Object.values(queue.shift()));
                } else {
                    //connection.disconnect(); //don't leave?
                }
            }
        });
    } else {
        queue.push({ soundEffect, voiceChannel, id });
    }
}

async function getTTS(textts) {

	//remove non alphanumeric characters and make it lower case
	textts = textts.replace(/[^0-9a-z\s]/gi, '');
	textts = textts.toLowerCase();
	// Construct the request
	const request = {
	  input: {text: textts},
	  // Select the language and SSML voice gender (optional)
	  voice: {languageCode: process.env.VOICE_LANGUAGE, name: process.env.VOICE_NAME, ssmlGender: process.env.VOICE_GENDER},
	  // select the type of audio encoding
	  audioConfig: {audioEncoding: 'MP3'},
	};

	// Performs the text-to-speech request if file doesn't exist
	fs.access('cache/'+textts+'.mp3', fs.F_OK, (err) => {
		if (err){
			const [response] = await client.synthesizeSpeech(request);
			// Write the binary audio content to a local file 
			const writeFile = util.promisify(fs.writeFile);
			await writeFile('cache/'+textts+'.mp3', response.audioContent, 'binary');
			console.log('Audio content written to file: '+textts+'.mp3');
		}
		return('cache/'+textts+'.mp3');
	}
	
}
function getUserName(guildMember){
	return (guildMember.nickname || guildMember.user.username);
}


client.on('voiceStateUpdate', async (oldMember, newMember) => {

    const { voiceChannel: newUserChannel } = newMember;
    const { voiceChannel: oldUserChannel } = oldMember;

    if(oldUserChannel === undefined && newUserChannel !== undefined) {
        addToQueue(getUserName(newMember), newMember.voiceChannel);
		addToQueue('has joined the channel', newMember.voiceChannel);
    } else if (newUserChannel === undefined) {
        addToQueue(getUserName(oldMember), oldMember.voiceChannel);
		addToQueue('has left the channel', oldMember.voiceChannel);
    }
});
