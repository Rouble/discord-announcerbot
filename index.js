require('dotenv').config();

const Discord = require('discord.js');
const ytdl = require('ytdl-core');
const lowdb = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

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

async function addToQueue(soundEffect, voiceChannel, id) {
    if (!isPlaying) {
        isPlaying = true;

        queue = queue.filter(({ id: idToRemove }) => id !== idToRemove);

        const connection = await voiceChannel.join();
        const youtubeStream = ytdl(soundEffect, { filter: 'audioonly' });
        const discordStream = connection.playStream(youtubeStream);

        discordStream.on('end', reason => {
            if (reason) {
                isPlaying = false;
                if (queue.length) {
                    addToQueue(...Object.values(queue.shift()));
                } else {
                    connection.disconnect();
                }
            }
        });
    } else {
        queue.push({ soundEffect, voiceChannel, id });
    }
}

client.on('voiceStateUpdate', async (oldMember, newMember) => {
    const soundEffect = db.get(`users.${newMember.user.id}`).value();
    if (!soundEffect) {
        return;
    }

    const { voiceChannel: newUserChannel } = newMember;
    const { voiceChannel: oldUserChannel } = oldMember;

    if(oldUserChannel === undefined && newUserChannel !== undefined) {
        addToQueue(soundEffect, newMember.voiceChannel);
    } else if (newUserChannel === undefined) {
        client.voiceConnections.every(connection => connection.disconnect());
    }
});
