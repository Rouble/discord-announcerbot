require('dotenv').config();

const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { Client, GatewayIntentBits } = require('discord.js');
const textToSpeech = require('@google-cloud/text-to-speech');
// Import other required libraries
const fs = require('fs');
const util = require('util');
// Creates clients
const ttsclient = new textToSpeech.TextToSpeechClient();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildMessages] });
const crypto = require('crypto');
//discordjs/audio stuff
const {
		joinVoiceChannel,
		createAudioPlayer,
		createAudioResource,
		AudioPlayerStatus,
		VoiceConnectionStatus,
		entersState	
} = require('@discordjs/voice');

client.login(process.env.DISCORD_BOT_TOKEN);

let queue = {};

client.on('ready', () => {
	console.log('announcerbot ready');
});

const commands = [
  {
    name: 'restart',
    description: 'Restart the bot process',
  },
  {
    name: 'say',
    description: 'Send a message to the voice channel queue',
    options: [
      {
        name: 'message',
        type: 'STRING',
        description: 'The message to send to the queue',
        required: true,
      },
    ],
  },
  {
    name: 'test',
    description: 'Add a test message to the voice channel queue',
  },
];

const rest = new REST({ version: '9' }).setToken(process.env.DISCORD_BOT_TOKEN);

client.on('guildCreate', async (guild) => {
  console.log(`Bot was added to guild ${guild.name}`);

  try {
    await rest.put(
      Routes.applicationGuildCommands(clientId, guild.id),
      { body: commands },
    );

    console.log(`Successfully registered slash commands for guild ${guild.id}`);
  } catch (error) {
    console.error(error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, options } = interaction;

  if (commandName === 'restart') {
    await interaction.reply('Restarting...');
    setTimeout(() => {
      process.exit(0);
    }, 500);
  } else if (commandName === 'say') {
    if (interaction.member.voice.channel) {
      const message = options.getString('message');
      addToQueue(message, interaction.member.voice.channel);
      await interaction.reply(`Message "${message}" added to the queue!`);
    } else {
      await interaction.reply('You must be in a voice channel to use this command!');
    }
  } else if (commandName === 'test') {
    if (interaction.member.voice.channel) {
      addToQueue('Test', interaction.member.voice.channel);
      await interaction.reply('Test message added to the queue!');
    } else {
      await interaction.reply('You must be in a voice channel to use this command!');
    }
  }
});



async function addToQueue(message, voiceState) {
		
	guildID = voiceState.guild.id;
	
	if (queue[guildID] === undefined) {
		queue[guildID] = { 
			queue: [],
			isPlaying: false,
		};
	}
	
    if (!queue[guildID].isPlaying) {
        queue[guildID].isPlaying = true;
		
		
		//const connection = await voiceState.channel.join();
		const connection = await joinVoiceChannel({
			channelId: voiceState.channelId,
			guildId: voiceState.guild.id,
			adapterCreator: voiceState.guild.voiceAdapterCreator
		});
		

		console.debug('playing: ' + message);
        readyAnnouncementFile(message, (err, filePath) => {
            if (err) {
                console.error(err);
                return;
            }

            console.debug('queueing message: ' + message);
			//const discordStream = connection.play(filePath); 
			
			const player = createAudioPlayer();
			const resource = createAudioResource(filePath);
			connection.subscribe(player);
			player.play(resource);
			//console.debug('played' + message);
			let timeout;
	
			player.on('stateChange', (oldState, newState) =>{
				console.log('state: ' + oldState.status + ' ' + newState.status);
				if (oldState.status === AudioPlayerStatus.AutoPaused && newState.status === AudioPlayerStatus.Playing) {
					
					console.log('started playing');
					//console.log(resource);
		            //const duration = resource.playbackDuration + 100;
                    timeout = setTimeout(() => {				
                       	console.log('stopping player due to timeout');
                      	player.stop();
                    }, 5000);
					
				} else if (newState.status === AudioPlayerStatus.Idle) {
					if (timeout) {
						clearTimeout(timeout);
						console.debug('cleared timeout');
					}
					queue[guildID].isPlaying = false;
                	if (queue[guildID].queue.length) { //TODO rewrite this to empty channel queue and exit channel if we're talking to ourself
                    	addToQueue(...Object.values(queue[guildID].queue.shift()));
                	} else {
                    	//if bot is alone in channel
                    	console.debug(voiceState.channel.members.size + ' users in channel');
                    	if(voiceState.channel.members.size < 2){
                        	connection.disconnect(); // leave
                    	}
                	}
                	console.debug('finished playing');
				} else if (newState.Status === AudioPlayerStatus.AutoPaused) {
				    //if bot is alone in channel
              		
					console.debug(voiceState.channel.members.size + ' users in channel');
                    if(voiceState.channel.members.size < 2){
                    	connection.disconnect(); // leave
						queue[guildID].isPlaying = false;
                	}	
				}
			});
			player.on('error', console.error);
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
      	//audioConfig: {audioEncoding: 'OGG_OPUS'}, //may want to add pitch and speaking rate options in .env file
		audioConfig: {audioEncoding: 'MP3'},
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
	
	const fileName = crypto.createHash('md5').update(message.toLowerCase()).digest('hex') + '.mp3';
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
	

	
	//console.debug(newState.channel);
	if (newMember.id != client.user.id){ //ignore myself
		
		
		if (oldState.channel === null && newState.channel  !== null){ //if not previously connected to a channel
			console.debug('-----joined ' + newState.channel.name + '-----');
			
			if (!newState.channel.joinable) return; //dont queue for unjoinable channels
			if (newState.channel.id == newState.guild.afkChannelId) return; //dont queue messages in afk channel
			
			addToQueue(getUserName(newMember) + " joined the channel", newState);
			return;
		}
		if (oldState.channel !== null && newState.channel  === null){ //if disconnect
			console.debug('-----left ' + oldState.channel.name + '-----');
            
			if (!oldState.channel.joinable) return; //dont queue for unjoinable channels
			if (oldState.channel.id == oldState.guild.afkChannelId) return; //dont queue messages in afk channel
			
			addToQueue(getUserName(oldMember) + " left the channel", oldState);
			return;
		}
		if (oldState.channel != newState.channel){ //if changed channel
			console.debug('-----changed channel-----');
			console.debug('from ' + oldState.channel.name + ' to ' + newState.channel.name); 
			
			if ((oldState.channel.joinable) && (oldState.channel.id != oldState.guild.afkChannelId)) {
				addToQueue(getUserName(oldMember) + " left the channel", oldState);
			}
            if ((newState.channel.joinable) && (newState.channel.id != newState.guild.afkChannelId)) {
				addToQueue(getUserName(newMember) + " joined the channel", newState); 
			}
			
			return;
		} 
		
		console.debug('-----here be dragons-----');
		
	}
});
