import { mediasoup as _mediasoup } from './config.js';
import { getPort, releasePort } from './port.js';
import FFmpeg from './ffmpeg.js';

export default class Peer {
  constructor(socket_id, socket, name) {
    this.id = socket_id;
    this.name = name;
    this.socket = socket;
    this.transports = new Map();
    this.consumers = new Map();
    this.producers = new Map();
    this.remotePorts = [];
    this.process = null;
    this.recorded = true;
  }

  getId() {
    return this.id;
  }

  sendRule(data) {
    this.socket.emit('rule', data);
  }

  addTransport(transport) {
    this.transports.set(transport.id, transport);
  }

  async connectTransport(transport_id, dtlsParameters) {
    if (!this.transports.has(transport_id)) return;

    await this.transports.get(transport_id).connect({
      dtlsParameters: dtlsParameters
    });
  }

  async createProducer(producerTransportId, rtpParameters, kind) {
    //TODO handle null errors
    let producer = await this.transports.get(producerTransportId).produce({
      kind,
      rtpParameters
    });

    this.producers.set(producer.id, producer);

    producer.on(
      'transportclose',
      function () {
        console.log('Producer transport close', { name: `${this.name}`, consumer_id: `${producer.id}` });
        producer.close();
        this.producers.delete(producer.id);
      }.bind(this)
    );

    return producer;
  }

  async createConsumer(consumer_transport_id, producer_id, rtpCapabilities) {
    let consumerTransport = this.transports.get(consumer_transport_id);

    let consumer = null;
    try {
      consumer = await consumerTransport.consume({
        producerId: producer_id,
        rtpCapabilities,
        paused: false //producer.kind === 'video',
      });
    } catch (error) {
      console.error('Consume failed', error);
      return;
    }

    if (consumer.type === 'simulcast') {
      await consumer.setPreferredLayers({
        spatialLayer: 2,
        temporalLayer: 2
      });
    }

    this.consumers.set(consumer.id, consumer);

    consumer.on(
      'transportclose',
      function () {
        console.log('Consumer transport close', { name: `${this.name}`, consumer_id: `${consumer.id}` });
        this.consumers.delete(consumer.id);
      }.bind(this)
    );

    return {
      consumer,
      params: {
        producerId: producer_id,
        id: consumer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        type: consumer.type,
        producerPaused: consumer.producerPaused
      },
      socket_id: this.id
    };
  }

  closeProducer(producer_id) {
    try {
      this.producers.get(producer_id).close();
    } catch (e) {
      console.warn(e);
    }

    this.producers.delete(producer_id);
  }

  getProducer(producer_id) {
    return this.producers.get(producer_id);
  }

  close() {
    this.transports.forEach((transport) => transport.close());
  }

  removeConsumer(consumer_id) {
    this.consumers.delete(consumer_id);
  }

  async publishProducerRtpStream(router, producer) {
    console.log('publishProducerRtpStream()');
  
    const rtpTransport = await router.createPlainTransport(_mediasoup.plainRtpTransport);
  
    // Set the receiver RTP ports
    const remoteRtpPort = await getPort();
    this.remotePorts.push(remoteRtpPort);
  
    let remoteRtcpPort;
  
    // Connect the mediasoup RTP transport to the ports used by GStreamer
    await rtpTransport.connect({
      ip: '127.0.0.1',
      port: remoteRtpPort,
      rtcpPort: remoteRtcpPort
    });
  
    this.addTransport(rtpTransport);
  
    const codecs = [];
    // Codec passed to the RTP Consumer must match the codec in the Mediasoup router rtpCapabilities
    const routerCodec = router.rtpCapabilities.codecs.find(
      codec => codec.kind === producer.kind
    );
    codecs.push(routerCodec);
  
    const rtpCapabilities = {
      codecs,
      rtcpFeedback: []
    };
  
    // Start the consumer paused
    // Once the gstreamer process is ready to consume resume and send a keyframe
    const consumer = await rtpTransport.consume({
      producerId: producer.id,
      rtpCapabilities
    });
  
    this.consumers.set(consumer.id, consumer);

    consumer.on(
      'transportclose',
      function () {
        console.log('Recorder consumer transport close', { name: `${this.name}`, consumer_id: `${consumer.id}` });
        this.consumers.delete(consumer.id);
        this.transports.delete(rtpTransport.id);
      }.bind(this)
    );
  
    return {
      remoteRtpPort,
      remoteRtcpPort,
      localRtcpPort: rtpTransport.rtcpTuple ? rtpTransport.rtcpTuple.localPort : undefined,
      rtpCapabilities,
      rtpParameters: consumer.rtpParameters,
      id: consumer.id
    };
  };

  async startRecord(router, callback) {
    try {
      console.log('Start record', { name: `${this.name}` });
      let recordInfo = {};
      this.recordConsumers = [];
    
      for (const [,producer] of this.producers) {
        recordInfo[producer.kind] = await this.publishProducerRtpStream(router, producer);
        this.recordConsumers.push(recordInfo[producer.kind].id);
      }
    
      recordInfo.fileName = this.id;
    
      this.process = new FFmpeg(recordInfo, callback);
      setTimeout(async () => {
        for (const [,consumer] of this.consumers) {
          // Sometimes the consumer gets resumed before the GStreamer process has fully started
          // so wait a couple of seconds
          await consumer.resume();
          await consumer.requestKeyFrame();
        }
      }, 1000);
    } catch (ex) {
      console.log('Record fail', ex);
      this.recorded = false;
      callback();
    }
  };

  stopRecord() {
    console.log('Stop record', { name: `${this.name}` });
    if (this.process) {
      for (const consumerId of this.recordConsumers) {
        this.consumers.get(consumerId).close();
      }
      this.recordConsumers = [];
      this.process.kill();
      this.process = null;
    }

    for (const remotePort of this.remotePorts) {
      releasePort(remotePort);
    }
  }
  
  isRecord() {
    return this.recorded;
  }
}
