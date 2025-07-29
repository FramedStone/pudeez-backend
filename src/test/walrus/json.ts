import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const PUBLISHER = process.env.PUBLISHER!;
const AGGREGATOR = process.env.AGGREGATOR!;

async function uploadJsonFile(filePath: string): Promise<string | undefined> {
  const jsonContent = fs.readFileSync(filePath, 'utf-8');
  const response = await axios.put(
    `${PUBLISHER}/v1/blobs?epochs=1`,
    jsonContent,
    { headers: { 'Content-Type': 'application/json' } }
  );
  console.log('JSON API upload response:', response.data);
  return response.data.newlyCreated?.blobObject?.blobId;
}

async function downloadFile(blobId: string, outputDir: string) {
  const outputPath = path.join(outputDir, `${blobId}.json`);
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
  const blobId = await uploadJsonFile('src/test/walrus/data/test.json');
  if (blobId) {
    // Ensure the downloaded folder exists
    const downloadDir = path.join(__dirname, './downloaded');
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir);
    }
    await downloadFile(blobId, downloadDir);
  }
})();
