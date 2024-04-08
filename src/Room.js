import { mediasoup } from './config.js';
export default class Room {
  constructor(room_id, owner, maxCount, rule, worker, io) {
    this.id = room_id;
    this.owner = owner;
    this.maxCount = maxCount;
    this.rule = rule;
    this.count = 0;
    const mediaCodecs = mediasoup.router.mediaCodecs;
    worker
      .createRouter({
        mediaCodecs
      })
      .then(
        function (router) {
          this.router = router;
        }.bind(this)
      );

    this.peers = new Map();
    this.io = io;
  }

  loop(data) {
    if (data.length == 0) {
      this.peers.forEach((peer) => {
        peer.sendRule({ debater: 'end' });
      });
      return;
    }
    const cur = data.shift();
    this.peers.forEach((peer) => {
      peer.sendRule(cur);
    });
    setTimeout(() => {
      this.loop(data);
    }, cur.time * 1000);
  }

  start(name) {
    if (name !== this.owner)
      return false;
    this.loop(this.rule.data);
    return true;
  }

  joinable() {
    return this.count < this.maxCount;
  }

  addPeer(peer) {
    if (this.count < this.maxCount) {
      this.peers.set(peer.id, peer);
      this.count++;
      return true;
    }
    return false;
  }

  getProducerListForPeer() {
    let producerList = [];
    this.peers.forEach((peer) => {
      peer.producers.forEach((producer) => {
        producerList.push({
          producer_id: producer.id
        });
      });
    });
    return producerList;
  }

  getRtpCapabilities() {
    return this.router.rtpCapabilities;
  }

  async createWebRtcTransport(socket_id) {
    const { maxIncomingBitrate, initialAvailableOutgoingBitrate } = mediasoup.webRtcTransport;

    const transport = await this.router.createWebRtcTransport({
      listenIps: mediasoup.webRtcTransport.listenIps,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate
    });
    if (maxIncomingBitrate) {
      try {
        await transport.setMaxIncomingBitrate(maxIncomingBitrate);
      } catch (error) {
        console.log(error);
      }
    }

    transport.on(
      'dtlsstatechange',
      function (dtlsState) {
        if (dtlsState === 'closed') {
          console.log('Transport close', { name: this.peers.get(socket_id).name });
          transport.close();
        }
      }.bind(this)
    );

    transport.on('close', () => {
      console.log('Transport close', { name: this.peers.get(socket_id).name });
    });

    console.log('Adding transport', { transportId: transport.id });
    this.peers.get(socket_id).addTransport(transport);
    return {
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      }
    };
  }

  async connectPeerTransport(socket_id, transport_id, dtlsParameters) {
    if (!this.peers.has(socket_id)) return;

    await this.peers.get(socket_id).connectTransport(transport_id, dtlsParameters);
  }

  async produce(socket_id, producerTransportId, rtpParameters, kind) {
    // handle undefined errors
    return new Promise(
      async function (resolve, reject) {
        let producer = await this.peers.get(socket_id).createProducer(producerTransportId, rtpParameters, kind);
        resolve(producer.id);
        this.broadCast(socket_id, 'newProducers', [
          {
            producer_id: producer.id,
            producer_socket_id: socket_id
          }
        ]);
      }.bind(this)
    );
  }

  async consume(socket_id, consumer_transport_id, producer_id, rtpCapabilities) {
    // handle nulls
    if (
      !this.router.canConsume({
        producerId: producer_id,
        rtpCapabilities
      })
    ) {
      console.error('can not consume');
      return;
    }

    let { consumer, params } = await this.peers
      .get(socket_id)
      .createConsumer(consumer_transport_id, producer_id, rtpCapabilities);

    consumer.on(
      'producerclose',
      function () {
        console.log('Consumer closed due to producerclose event', {
          name: `${this.peers.get(socket_id).name}`,
          consumer_id: `${consumer.id}`
        });
        this.peers.get(socket_id).removeConsumer(consumer.id);
        // tell client consumer is dead
        this.io.to(socket_id).emit('consumerClosed', {
          consumer_id: consumer.id
        });
      }.bind(this)
    );

    return params;
  }

  async removePeer(socket_id) {
    this.peers.get(socket_id).close();
    this.peers.delete(socket_id);
    this.count--;
  }

  closeProducer(socket_id, producer_id) {
    this.peers.get(socket_id).closeProducer(producer_id);
  }

  broadCast(socket_id, name, data) {
    for (let otherID of Array.from(this.peers.keys()).filter((id) => id !== socket_id)) {
      this.send(otherID, name, data);
    }
  }

  send(socket_id, name, data) {
    this.io.to(socket_id).emit(name, data);
  }

  getPeers() {
    return this.peers;
  }

  toJson() {
    function replacer(key, value) {
      // Filtering out properties
      if (key === "socket") {
        return undefined;
      }
      return value;
    }
    return {
      id: this.id,
      maxCount: this.maxCount,
      peers: JSON.stringify([...this.peers], replacer)
    };
  }
}
