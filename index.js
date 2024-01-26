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
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildMessages]
});
const crypto = require('crypto');
//discordjs/audio stuff
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    getVoiceConnection,
    entersState
} = require('@discordjs/voice');

client.login(process.env.DISCORD_BOT_TOKEN);

let globalqueue = {};

const commands = [
    {
        name: 'restart',
        description: 'Restart the bot process',
        defaultPermission: false,
        permissions: [
            {
                id: process.env.OWNER,
                type: 'USER',
                permission: true,
            }
        ],
    },
    {
        name: 'say',
        description: 'Send a message to the voice channel queue',
        options: [
            {
                name: 'message',
                type: 3,
                description: 'The message to send to the queue',
                required: true,
            },
        ],
    },
    {
        name: 'test',
        description: 'Add a test message to the voice channel queue',
        defaultPermission: false,
        options: [
            {
                type: 7,
                name: "voicechannel",
                description: "What voice channel to test in?",
            }, 
        ],
        permissions: [
            {
                id: process.env.OWNER,
                type: 'USER',
                permission: true,
            }
        ],
    },
    {
        name: 'stop',
        description: 'Make the bot stop saying the current thing',
    },
];

const rest = new REST({ version: '9' }).setToken(process.env.DISCORD_BOT_TOKEN);

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, options } = interaction;
    
    if (commandName === 'restart') {
        await interaction.reply('Restarting...');
        setTimeout(() => {
            process.exit(0);
        }, 500);
    }
    else if (commandName === 'say') {
        if (interaction.member.voice.channel) {
            const message = options.getString('message');
            addToQueue(message, interaction.member.voice);
            await interaction.reply(`Message "${message}" added to the queue!`);
        }
        else {
            await interaction.reply({ content: 'You must be in a voice channel to use this command!', ephemeral: true });
        }
    }
    else if (commandName === 'test') {
        if (interaction.member.voice.channel) {
            addToQueue('Test', interaction.member.voice);
            await interaction.reply({ content: 'Test message added to the queue!', ephemeral: true });
        }
        else {
            await interaction.reply({ content: 'You must be in a voice channel to use this command!', ephemeral: true});
        }
    }
    else if (commandName === 'stop') {
        const guildID = interaction.member.voice.guild.id;
        if (interaction.member.voice.channel) {
            try {
                globalqueue[guildID].player.stop();
                await interaction.reply({ content: 'Stopping message', ephemeral: true});
            } 
            catch {
                console.debug('stop failed, i probably wasn\'t talking.');
            }
        }
        else {
            await interaction.reply({ content: 'You must be in a voice channel to use this command!', ephemeral: true});
        }
    }
});

client.on('ready', async () => {
    console.log('announcerbot ready');

    try {
        await rest.put( Routes.applicationCommands(client.user.id), { body: commands }, );
        console.log(`Successfully registered global slash commands`);
    }
    catch (error) {
        console.error(error);
    }
});

async function addToQueue(message, voiceState) {
    const guildID = voiceState.guild.id;

    if (!voiceState.channel) {
        return;
    }

    // Initialize globalqueue[guildID] if it doesn't exist
    if (!globalqueue[guildID]) {
        globalqueue[guildID] = {
            queue: [],
            player: createAudioPlayer(),
            playeron: false,
            processing: false
        };
    }

    let connection = getVoiceConnection(guildID);
    let playerStatus = globalqueue[guildID].player.state.status;
    
    // Check if the bot is currently busy, and queue the message, the player will handle it
    if (globalqueue[guildID].processing ||
		(playerStatus === AudioPlayerStatus.Playing) ||
        (playerStatus === AudioPlayerStatus.Buffering)) {
        // Add the new message to the queue and return
        console.debug("already talking / about to talk. adding to queue");
        globalqueue[guildID].queue.push({
            message,
            voiceState
        });
        return;
    } else {
		globalqueue[guildID].processing = true
	}

    //do we have no connection/connection but no channel/idle in the wrong channel? connect to new channel.
    if (!connection ||
            (connection.joinConfig.channelId === null) ||
			( (connection.joinConfig.channelId !== voiceState.channelId) && (playerStatus === AudioPlayerStatus.Idle) )) {
        console.debug("joining voice channel");
		connection = joinVoiceChannel({
			channelId: voiceState.channelId,
			guildId: voiceState.guild.id,
			adapterCreator: voiceState.guild.voiceAdapterCreator,
		});                    
	}

    // Check if the bot is currently busy, and queue the message, the player will handle it
	if ((playerStatus === AudioPlayerStatus.Playing) ||
	    (playerStatus === AudioPlayerStatus.Buffering)) {
	    // Add the new message to the queue and return
	    console.debug("already talking / about to talk. adding to queue");
	    globalqueue[guildID].queue.push({
	        message,
	        voiceState
	    });
	   	return;
    }
	


    let player = globalqueue[guildID].player;
    connection.subscribe(player);
    
    
    if(!globalqueue[guildID].playeron) {
        globalqueue[guildID].playeron = true;

        player.on('error', console.error);
        player.on('stateChange', async (oldState, newState) => {
            console.debug("player state change: " + newState.status);
            if (newState.status === AudioPlayerStatus.Idle) {
				globalqueue[guildID].processing = false;
                
				const nextMessage = globalqueue[guildID].queue.shift();
                if (nextMessage) {
                    addToQueue(nextMessage.message, nextMessage.voiceState);
                }
                else {
                    if (getVoiceConnection(guildID)) {
                        const connection = getVoiceConnection(guildID);
                        connection.disconnect();
                        player.stop();
                    }
                }
            }
        });
    }

    await playMessage({message, player});
}

async function playMessage({message, player}) {
    const audioContent = await generateAudioContent(message);
    const audioResource = createAudioResource(audioContent);
    console.debug("playMessage");
    player.play(audioResource);
}

async function generateAudioContent(message) { //TODO playback is choking on whatever this is returning
    const cacheDirectory = './cache/';
    const cacheFilename = crypto.createHash('sha1').update(message.toLowerCase()).digest('hex') + '.ogg';
    const cachePath = cacheDirectory + cacheFilename;

    // Check if the file exists in the cache
    try {
        await util.promisify(fs.access)(cachePath, fs.constants.F_OK);
        console.debug(`Reading audio from cache for '${message}'`);
        return fs.createReadStream(cachePath);
    }
    catch {}

    console.debug(`Generating audio for '${message}'`);
    const request = {
        input: {
            text: message
        },
        voice: {
            languageCode: process.env.VOICE_LANGUAGE,
            name: process.env.VOICE_NAME,
            ssmlGender: process.env.VOICE_GENDER
        },
        audioConfig: {
            audioEncoding: 'OGG_OPUS'
        },
    };

    // Performs the text-to-speech request
    const [response] = await ttsclient.synthesizeSpeech(request);
    const audioContent = response.audioContent;

    // Cache the audio to disk
    try {
        await util.promisify(fs.mkdir)(cacheDirectory, {
            recursive: true
        });
        await util.promisify(fs.writeFile)(cachePath, audioContent, {
            encoding: null
        });
        return fs.createReadStream(cachePath);
        console.debug(`Wrote audio to cache for '${message}'`);
    }
    catch (err) {
        console.error(`Failed to write audio cache for '${message}': ${err}`);
    }

}

function getUserName(guildMember) {
    return (guildMember.nickname || guildMember.user.username);
}

function shouldJoin(voicestate, count) {
    if (voicestate.channel === null) return false; //don't join null channels
    if (!voicestate.channel.joinable) return false; //don't join unjoinable channels
    if (voicestate.channel.id == voicestate.guild.afkChannelId) return false; //don't join the afk channel
    if (voicestate.channel.members.size < count) return false; //don't join empty channels. the 1 member is the person in question.
    
    return true;
}

client.on('voiceStateUpdate', async (oldState, newState) => {
    var oldMember = oldState.member;
    var newMember = newState.member;
    
    if (newMember.id != client.user.id) { //ignore myself

        if (oldState.channel != newState.channel) { //if changed channel
            console.debug('-----changed channel-----');

            if ( shouldJoin(oldState, 1) ) {
                console.debug(getUserName(oldMember) + " left " + oldState.channel.name + " in " + oldState.guild.name);
                addToQueue(getUserName(oldMember) + " left the channel", oldState);
            }
            if ( shouldJoin(newState, 2) ) {
                console.debug(getUserName(newMember) + " joined " + newState.channel.name + " in " + newState.guild.name); 
                addToQueue(getUserName(newMember) + " joined the channel", newState);
            }

            return;
        }

        //voice state updates can be emitted for streams stopping and starting and users muting and unmuting themsleves. we're only interested in channel changes
        console.debug('-----here be dragons-----');

    }
});
