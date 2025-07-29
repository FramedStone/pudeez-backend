import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const PUBLISHER = process.env.PUBLISHER!;
const AGGREGATOR = process.env.AGGREGATOR!;

async function uploadFile(filePath: string): Promise<string | undefined> {
  const fileStream = fs.createReadStream(filePath);
  const response = await axios.put(
    `${PUBLISHER}/v1/blobs?epochs=1`,
    fileStream,
    { headers: { 'Content-Type': 'application/octet-stream' } }
  );
  console.log('Upload response:', response.data);
  return response.data.newlyCreated?.blobObject?.blobId;
}

async function downloadFile(blobId: string, outputDir: string) {
  const outputPath = path.join(outputDir, `${blobId}.txt`);
  const response = await axios.get(
    `${AGGREGATOR}/v1/blobs/${blobId}`,
    { responseType: 'stream' }
  );
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    writer.on('finish', () => resolve(undefined));
    writer.on('error', reject);
  });
  console.log(`File downloaded as ${outputPath}`);
}

(async () => {
  const blobId = await uploadFile('src/test/walrus/data/test.txt');
  if (blobId) {
    // Ensure the downloaded folder exists
    const downloadDir = path.join(__dirname, './downloaded');
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir);
    }
    await downloadFile(blobId, downloadDir);
  }
})();
