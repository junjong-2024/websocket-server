import amqp from 'amqplib/callback_api.js';

export default class RenderQueue {
    constructor(host) {
        amqp.connect(`amqp://${host}`, (error0, connection) => {
            console.log(`connect to ${host}`);
            this.connection = connection;
        });
    }

    enqueue(data) {
        this.connection.createChannel(function(error1, channel) {
            if (error1) {
              throw error1;
            }
            const queue = 'render';
        
            channel.assertQueue('queue', {
              durable: false
            });
        
            channel.sendToQueue(queue, Buffer.from(data));
          });
    }
}