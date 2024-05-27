import Queue from 'bull';

export default class RenderQueue {
    constructor(redisConfig) {
        this.q = new Queue('render', { redis: redisConfig });
    }

    enqueue(data) {
        this.q.add(data);
    }
}