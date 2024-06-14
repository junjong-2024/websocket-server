import express from 'express';

import { createServer } from 'httpolyglot';
import { readFileSync } from 'fs';
import { createWorker } from 'mediasoup';
import { sslKey, sslCrt, listenPort, listenIp, mediasoup as _mediasoup } from './config.js';
import { join } from 'path';
import Room from './Room.js';
import Peer from './Peer.js';
import { Server } from 'socket.io';
import path from 'path';
import { expressjwt } from 'express-jwt';
import RenderQueue from './RenderQueue.js';
import { makeid } from './utils.js';

const __dirname = path.resolve();
const app = express();
app.use(express.json());

const options = {
  key: readFileSync(join(__dirname, sslKey), 'utf-8'),
  cert: readFileSync(join(__dirname, sslCrt), 'utf-8')
};

const sample_debate = {
  name: '토론대회1',
  description: '주제는 어쩌구 입니다 지금부터 토론을 시작하겠습니다.',
  teamSize: 2,
  orderSize: 3,
  rules: [
    { debater: 'team_0_0', msg: '팀 A 입안', time: 1 },
    { debater: 'team_1_0', msg: '팀 B 입안', time: 1 },
    { debater: 'team_0_1', msg: '팀 A 교차질의', time: 1 },
    { debater: 'team_1_1', msg: '팀 B 교차질의', time: 1 },
    { debater: 'team_0_2', msg: '팀 A 반박', time: 1 },
    { debater: 'team_1_2', msg: '팀 B 반박', time: 1 },
    { debater: 'team_0_0', msg: '팀 A 마무리', time: 1 },
    { debater: 'team_1_0', msg: '팀 B 마무리', time: 1 }
  ]
};

const httpsServer = createServer(options, app);
const io = new Server(httpsServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(express.static(join(__dirname, '.', 'public')));
// expressjwt({ secret: process.env.JWT_SECRET, algorithms: ["HS512"] })
app.post('/room/:id', async (req, res) => {
  // const userId = req.auth.sub;
  let room_id = makeid(6);
  // while (roomList.has(room_id))
  //   room_id = makeid(6);
  // console.log('AUTH:', userId);
  // console.log('BODY:', req.body);
  // console.log('Created room', { room_id: room_id });
  let worker = await getMediasoupWorker();
  roomList.set(room_id, new Room(req.params.id, room_id, req.body.name, req.body, worker, io, renderQueue));
  res.send({
    room_id 
  });
});

httpsServer.listen(listenPort, () => {
  console.log('Listening on https://' + listenIp + ':' + listenPort);
});


const redisConfig = {
  host: '127.0.0.1', // Redis server address
  port: 6379,        // Redis server port
  // You can add more Redis connection options here if needed
};
const renderQueue = new RenderQueue(redisConfig);

// all mediasoup workers
let workers = [];
let nextMediasoupWorkerIdx = 0;

/**
 * roomList
 * {
 *  room_id: Room {
 *      id:
 *      router:
 *      peers: {
 *          id:,
 *          name:,
 *          master: [boolean],
 *          transports: [Map],
 *          producers: [Map],
 *          consumers: [Map],
 *          rtpCapabilities:
 *      }
 *  }
 * }
 */
let roomList = new Map()

;(async () => {
  await createWorkers();
})();

async function createWorkers() {
  let { numWorkers } = _mediasoup;

  for (let i = 0; i < numWorkers; i++) {
    let worker = await createWorker({
      logLevel: _mediasoup.worker.logLevel,
      logTags: _mediasoup.worker.logTags,
      rtcMinPort: _mediasoup.worker.rtcMinPort,
      rtcMaxPort: _mediasoup.worker.rtcMaxPort
    });

    worker.on('died', () => {
      console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
      setTimeout(() => process.exit(1), 2000);
    });
    workers.push(worker);

    // log worker resource usage
    /*setInterval(async () => {
            const usage = await worker.getResourceUsage();

            console.info('mediasoup Worker resource usage [pid:%d]: %o', worker.pid, usage);
        }, 120000);*/
  }
}

io.on('connection', (socket) => {
  // socket.on('createRoom', async ({ room_id, name }, callback) => {
  //   if (roomList.has(room_id)) {
  //     callback('already exists');
  //   } else {
  //     console.log('Created room', { room_id: room_id });
  //     let worker = await getMediasoupWorker();
  //     roomList.set(room_id, new Room(room_id, name, structuredClone(sample_debate), worker, io, renderQueue));
  //     callback(room_id);
  //   }
  });

  socket.on('start', ({ room_id, name }, cb) => {
    console.log('Debate start', {
      room_id: room_id,
      name: name
    });
    if (!roomList.has(room_id)) {
      return cb({
        error: 'Room does not exist'
      });
    }
    const room = roomList.get(room_id);
    if (!room.start(name))
      return cb({
        error: 'Fail to start debate'
      });
  });

  socket.on('join', ({ room_id, name }, cb) => {
    console.log('User joined', {
      room_id: room_id,
      name: name
    });

    if (!roomList.has(room_id)) {
      return cb({
        error: 'Room does not exist'
      });
    }
    const room = roomList.get(room_id);
    let locate = room.addPeer(new Peer(socket.id, socket, name));
    if (locate) {
      socket.room_id = room_id;
      cb({
        ...roomList.get(room_id).toJson(),
        team: locate[0],
        order: locate[1]
      });
    } else {
      console.log('User join failed', {
        room_id: room_id,
        name: name
      });
      cb({ error: 'The room is full.' });
    }
  });

  socket.on('swapUser', ({ team_0, order_0, team_1, order_1 }) => {
    console.log('User swap', {
      team_0, order_0, team_1, order_1
    });
    roomList.get(socket.room_id).swapLocatePeer(socket.id, team_0, order_0, team_1, order_1);
  });

  socket.on('getProducers', () => {
    if (!roomList.has(socket.room_id)) return;
    console.log('Get producers', { name: `${roomList.get(socket.room_id).getPeers().get(socket.id).name}` });

    // send all the current producer to newly joined member
    let producerList = roomList.get(socket.room_id).getProducerListForPeer();

    socket.emit('newProducers', producerList);
  });

  socket.on('getRouterRtpCapabilities', (_, callback) => {
    console.log('Get RouterRtpCapabilities', {
      name: `${roomList.get(socket.room_id).getPeers().get(socket.id).name}`
    });

    try {
      callback(roomList.get(socket.room_id).getRtpCapabilities());
    } catch (e) {
      callback({
        error: e.message
      });
    }
  });

  socket.on('createWebRtcTransport', async (_, callback) => {
    console.log('Create webrtc transport', {
      name: `${roomList.get(socket.room_id).getPeers().get(socket.id).name}`
    });

    try {
      const { params } = await roomList.get(socket.room_id).createWebRtcTransport(socket.id);

      callback(params);
    } catch (err) {
      console.error(err);
      callback({
        error: err.message
      });
    }
  });

  socket.on('connectTransport', async ({ transport_id, dtlsParameters }, callback) => {
    console.log('Connect transport', { name: `${roomList.get(socket.room_id).getPeers().get(socket.id).name}` });

    if (!roomList.has(socket.room_id)) return;
    await roomList.get(socket.room_id).connectPeerTransport(socket.id, transport_id, dtlsParameters);

    callback('success');
  });

  socket.on('produce', async ({ kind, rtpParameters, producerTransportId }, callback) => {
    if (!roomList.has(socket.room_id)) {
      return callback({ error: 'not is a room' });
    }

    let producer_id = await roomList.get(socket.room_id).produce(socket.id, producerTransportId, rtpParameters, kind);

    console.log('Produce', {
      type: `${kind}`,
      name: `${roomList.get(socket.room_id).getPeers().get(socket.id).name}`,
      id: `${producer_id}`
    });

    callback({
      producer_id
    });
  });

  socket.on('consume', async ({ consumerTransportId, producerId, rtpCapabilities }, callback) => {
    //TODO null handling
    let params = await roomList.get(socket.room_id).consume(socket.id, consumerTransportId, producerId, rtpCapabilities);

    console.log('Consuming', {
      name: `${roomList.get(socket.room_id) && roomList.get(socket.room_id).getPeers().get(socket.id).name}`,
      producer_id: `${producerId}`,
      consumer_id: `${params.id}`
    });

    callback(params);
  });

  // socket.on('resume', async (data, callback) => {
  //   await consumer.resume()
  //   callback()
  // })

  socket.on('getMyRoomInfo', (_, cb) => {
    cb(roomList.get(socket.room_id).toJson());
  });

  socket.on('disconnect', () => {
    console.log('Disconnect', {
      name: `${roomList.get(socket.room_id) && roomList.get(socket.room_id).getPeers().get(socket.id).name}`
    });

    if (!socket.room_id) return;
    roomList.get(socket.room_id).removePeer(socket.id);
  });

  socket.on('producerClosed', ({ producer_id }) => {
    console.log('Producer close', {
      name: `${roomList.get(socket.room_id) && roomList.get(socket.room_id).getPeers().get(socket.id).name}`
    });

    roomList.get(socket.room_id).closeProducer(socket.id, producer_id);
  });

  socket.on('exitRoom', async (_, callback) => {
    console.log('Exit room', {
      name: `${roomList.get(socket.room_id) && roomList.get(socket.room_id).getPeers().get(socket.id).name}`
    });

    if (!roomList.has(socket.room_id)) {
      callback({
        error: 'not currently in a room'
      });
      return;
    }
    // close transports
    await roomList.get(socket.room_id).removePeer(socket.id);
    if (roomList.get(socket.room_id).getPeers().size === 0) {
      roomList.delete(socket.room_id);
    }

    socket.room_id = null;

    callback('successfully exited room');
  });
});

// TODO remove - never used?
function room() {
  return Object.values(roomList).map((r) => {
    return {
      router: r.router.id,
      peers: Object.values(r.peers).map((p) => {
        return {
          name: p.name
        };
      }),
      id: r.id
    };
  });
}

/**
 * Get next mediasoup Worker.
 */
function getMediasoupWorker() {
  const worker = workers[nextMediasoupWorkerIdx];

  if (++nextMediasoupWorkerIdx === workers.length) nextMediasoupWorkerIdx = 0;

  return worker;
}
