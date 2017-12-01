const builder = require("./builder.js"),
  S3Bucket = require("./s3.js"),
  fs = require("fs"),
  ffmpeg = require("fluent-ffmpeg"),
  path = require("path");

function getMetadata(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, function(err, metadata) {
      if (err) { return reject(err); }
      resolve({
        duration: Math.round(metadata.format.duration),
        format: metadata.format.format_name
      });
    });
  });
}

function encodeTitle(name) {
  return name.replace(/[^A-Za-z0-9_\-]/g, "-").toLowerCase();
}

function getPodcastItem(bucket, item) {
  const TYPE_FOR_FORMAT = {
    mp3: "audio/mpeg",
    ogg: "audio/ogg"
  };

  return getMetadata(item.localPath).then(({duration, format}) => {
    const type = TYPE_FOR_FORMAT[format];
    const extension = path.extname(item.localPath);
    if (!type) {
      throw new Error(`Unknown audio format: ${format}`);
    }
    return {
      title: item.title,
      description: item.description,
      pubDate: item.pubDate,
      enclosure: {
        url: `https://s3.amazonaws.com/${bucket.name}/${encodeTitle(item.filename)}${extension}`,
        length: duration,
        type
      },
      'itunes:title': item['itunes:title'],
      'itunes:summary': item['itunes:summary'],
      'itunes:episodeType': item['itunes:episodeType'],
      'itunes:explicit': item['itunes:explicit'],
      'itunes:season': item['itunes:season']
    };
  });
}

function upsertItem(bucket, item) {
  const data = fs.readFileSync(item.localPath);
  const extension = path.extname(item.localPath);
  const key = `${encodeTitle(item.filename)}${extension}`;
  return bucket.upsertObject(key, data);
}

async function sync(bucketName, data, logger) {
  let info = function(){};
  if (logger) {
    info = logger.info;
  }

  info("(s3-podcast) starting sync", {bucket: bucketName});
  let bucket = new S3Bucket(bucketName, "public-read");
  const bucketExists = !!(await bucket.head());
  info("(s3-podcast) bucket exists", {exists: bucketExists});
  if (!bucketExists) {
    info("(s3-podcast) creating bucket");
    await bucket.create();
    info("(s3-podcast) bucket created");
  }
  let podcastItems = [];
  for (let item of data.items) {
    info("(s3-podcast) processing item", {title: item.title});
    await upsertItem(bucket, item);
    info("(s3-podcast) item uploaded to s3", {title: item.title});
    const podcastItem = await getPodcastItem(bucket, item);
    podcastItems.push(podcastItem);
  }
  const feedData = {
    title: data.title,
    description: data.description,
    copyright: data.copyright,
    link: `https://s3.amazonaws.com/${bucket.name}/feed.rss`,
    language: data.language,
    pubDate: data.pubDate,
    lastBuildDate: data.lastBuildDate,
    items: podcastItems,
    "itunes:type": data['itunes:type'],
    "itunes:subtitle": data['itunes:subtitle'],
    "itunes:summary": data['itunes:summary'],
    "itunes:author": data['itunes:author'],
    "itunes:category": data['itunes:category'],
    "itunes:explicit": data['itunes:explicit'],
    "itunes:image": data['itunes:image'],
    "itunes:owner": data['itunes:owner']
  };
  const serializedFeedData = builder(feedData);
  info("(s3-podcast) generated feed");
  await bucket.upsertObject("feed.rss", serializedFeedData);
  info("(s3-podcast) sync completed");
}

module.exports = sync;
