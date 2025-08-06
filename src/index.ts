import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

import { Database, User, AssetRecord, SteamInventoryResponse } from './database_handler';
import { SteamAsset, storeAssetOnWalrus, retrieveAssetFromWalrus } from './walrus_handler';

// Get env vars
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3111;
const DB_NAME = "data.sqlite3";

// Initialize database
const db = new Database(DB_NAME);

// -- Middlewares --
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});

// Error handling middleware
app.use(
    (
        err: Error,
        req: Request,
        res: Response,
        // gotta love this shit
        // eslint-disable-next-line
        next: NextFunction
    ) => {
      console.error(err.stack);
      res.status(500).json({ error: 'Something went wrong!' });
});


// -- Endpoints --
// Health check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Welcome to the Express.js TypeScript API!' });
});

// Get the ZK proof from PROVER_URL
app.post('/api/generate_zkp', (req: Request, res: Response) => {
    axios.post(process.env.PROVER_URL || "", req.body, { headers: { 'Content-Type': 'application/json' } })
        .then(prover_response => res.json(prover_response.data))
        .catch(err => console.error(err));
});

// Insert new address & steamID pair from user
app.post('/api/user/add', (req: Request, res: Response) => {
    const userData = req.body as User;
    db.addRow(userData.address, userData.steamID);

    // no response
    res.status(200);
});

app.post('/api/user/get_steamid', (req: Request, res: Response) => {
    const steamID = db.getSteamID(req.body.address)

    res.status(200).json({
        steamID: steamID
    });
})

// Get Steam inventory for a user
app.get('/api/steam/inventory/:steamID', async (req: Request, res: Response) => {
    try {
        const { steamID } = req.params;
        const appid = req.query.appid ? parseInt(req.query.appid as string) : 730; // Default to CS:GO
        const contextid = req.query.contextid ? parseInt(req.query.contextid as string) : 2; // Default context

        // Validate steamID (should be numeric)
        if (!steamID || !/^\d+$/.test(steamID)) {
            return res.status(400).json({
                error: 'Invalid Steam ID format. Must be numeric.'
            });
        }

        // Validate appid and contextid
        if (appid < 1 || contextid < 1) {
            return res.status(400).json({
                error: 'Invalid appid or contextid. Must be positive integers.'
            });
        }

        const steamApiUrl = `https://steamcommunity.com/inventory/${steamID}/${appid}/${contextid}`;
        
        console.log(`Fetching Steam inventory from: ${steamApiUrl}`);
        
        const response = await axios.get<SteamInventoryResponse>(steamApiUrl);
        const inventoryData = response.data;

        // Check if Steam API returned success
        if (!inventoryData.success || inventoryData.success !== 1) {
            return res.status(404).json({
                error: inventoryData.error || 'Steam inventory not found or private'
            });
        }

        // Check if assets and descriptions exist
        if (!inventoryData.assets || !inventoryData.descriptions) {
            return res.status(200).json({
                appid: appid,
                assets: []
            });
        }

        // Create a map of descriptions for faster lookup
        const descriptionsMap = new Map<string, typeof inventoryData.descriptions[0]>();
        inventoryData.descriptions.forEach(desc => {
            const key = `${desc.classid}_${desc.instanceid}`;
            descriptionsMap.set(key, desc);
        });

        // Merge assets with descriptions to get icon_url and name
        const inventoryAssets = [];
        for (const asset of inventoryData.assets) {
            const key = `${asset.classid}_${asset.instanceid}`;
            const description = descriptionsMap.get(key);
            
            // Check if description exists and has required fields
            if (!description) {
                return res.status(500).json({
                    error: `Missing description data for asset ${asset.assetid} (classid: ${asset.classid}, instanceid: ${asset.instanceid})`
                });
            }
            
            if (!description.icon_url) {
                return res.status(500).json({
                    error: `Missing icon_url for asset ${asset.assetid} (classid: ${asset.classid}, instanceid: ${asset.instanceid})`
                });
            }
            
            if (!description.name) {
                return res.status(500).json({
                    error: `Missing name for asset ${asset.assetid} (classid: ${asset.classid}, instanceid: ${asset.instanceid})`
                });
            }
            
            inventoryAssets.push({
                contextid: asset.contextid,
                assetid: asset.assetid,
                classid: asset.classid,
                instanceid: asset.instanceid,
                amount: asset.amount,
                icon_url: description.icon_url,
                name: description.name
            });
        }

        res.status(200).json({
            appid: appid,
            assets: inventoryAssets
        });

    } catch (error) {
        console.error('Error fetching Steam inventory:', error);
        
        // Handle axios errors specifically
        if (axios.isAxiosError(error)) {
            if (error.response?.status === 403) {
                return res.status(403).json({
                    error: 'Steam inventory is private or user not found'
                });
            } else if (error.response?.status === 500) {
                return res.status(502).json({
                    error: 'Steam API is currently unavailable'
                });
            }
        }
        
        res.status(500).json({
            error: 'Failed to fetch Steam inventory'
        });
    }
});

// Store Steam asset data on Walrus
app.post('/api/walrus/store', async (req: Request, res: Response) => {
    try {
        const assetData = req.body as SteamAsset;
        
        // Validate required fields
        if (!assetData.appid || !assetData.assetid || !assetData.walletAddress || !assetData.icon_url) {
            return res.status(400).json({ 
                error: 'Missing required fields: appid, assetid, walletAddress, and icon_url are required' 
            });
        }

        // Basic Sui address validation (0x followed by 64 hex characters)
        const suiAddressRegex = /^0x[a-fA-F0-9]{64}$/;
        if (!suiAddressRegex.test(assetData.walletAddress)) {
            return res.status(400).json({
                error: 'Invalid Sui wallet address format. Must be 0x followed by 64 hex characters'
            });
        }

        const blobId = await storeAssetOnWalrus(assetData);
        
        if (blobId) {
            // Store asset record in database
            const assetRecord: AssetRecord = {
                walletAddress: assetData.walletAddress,
                blobId: blobId,
                appid: assetData.appid,
                assetid: assetData.assetid,
                classid: assetData.classid,
                instanceid: assetData.instanceid,
                contextid: assetData.contextid,
                amount: assetData.amount,
                icon_url: assetData.icon_url,
                uploadedAt: new Date().toISOString()
            };

            try {
                await db.addAsset(assetRecord);
                res.status(200).json({
                    success: true,
                    blobId: blobId,
                    walletAddress: assetData.walletAddress,
                    message: 'Asset data stored successfully on Walrus and database'
                });
            } catch (dbError) {
                console.error('Error storing asset in database:', dbError);
                // Still return success since Walrus storage worked
                res.status(200).json({
                    success: true,
                    blobId: blobId,
                    walletAddress: assetData.walletAddress,
                    message: 'Asset data stored on Walrus but failed to update database',
                    warning: 'Database update failed'
                });
            }
        } else {
            res.status(500).json({
                error: 'Failed to store asset data on Walrus'
            });
        }
    } catch (error) {
        console.error('Error in walrus store endpoint:', error);
        res.status(500).json({
            error: 'Internal server error while storing asset data'
        });
    }
});

// Retrieve Steam asset data from Walrus
app.get('/api/walrus/retrieve/:blobId', async (req: Request, res: Response) => {
    try {
        const { blobId } = req.params;
        
        if (!blobId) {
            return res.status(400).json({
                error: 'Blob ID is required'
            });
        }

        const assetData = await retrieveAssetFromWalrus(blobId);
        
        res.status(200).json({
            success: true,
            data: assetData,
            blobId: blobId
        });
    } catch (error) {
        console.error('Error in walrus retrieve endpoint:', error);
        res.status(500).json({
            error: 'Failed to retrieve asset data from Walrus'
        });
    }
});

// Get all assets for a specific wallet address
app.get('/api/walrus/assets/:walletAddress', async (req: Request, res: Response) => {
    try {
        const { walletAddress } = req.params;
        
        if (!walletAddress) {
            return res.status(400).json({
                error: 'Wallet address is required'
            });
        }

        // Basic Sui address validation
        const suiAddressRegex = /^0x[a-fA-F0-9]{64}$/;
        if (!suiAddressRegex.test(walletAddress)) {
            return res.status(400).json({
                error: 'Invalid Sui wallet address format'
            });
        }

        const assets = await db.getAssetsByWallet(walletAddress);
        
        res.status(200).json({
            success: true,
            walletAddress: walletAddress,
            assets: assets,
            count: assets.length
        });
    } catch (error) {
        console.error('Error in get assets by wallet endpoint:', error);
        res.status(500).json({
            error: 'Failed to retrieve assets for wallet address'
        });
    }
});

// Get all assets (with optional pagination)
app.get('/api/walrus/assets', async (req: Request, res: Response) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
        const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
        
        // Validate pagination parameters
        if (limit && (limit < 1 || limit > 100)) {
            return res.status(400).json({
                error: 'Limit must be between 1 and 100'
            });
        }
        
        if (offset && offset < 0) {
            return res.status(400).json({
                error: 'Offset must be non-negative'
            });
        }

        const assets = await db.getAllAssets(limit, offset);
        
        res.status(200).json({
            success: true,
            assets: assets,
            count: assets.length,
            pagination: {
                limit: limit || null,
                offset: offset || null
            }
        });
    } catch (error) {
        console.error('Error in get all assets endpoint:', error);
        res.status(500).json({
            error: 'Failed to retrieve assets'
        });
    }
});

// Delete an asset (removes from database, but not from Walrus)
app.delete('/api/walrus/assets/:blobId', async (req: Request, res: Response) => {
    try {
        const { blobId } = req.params;
        const { walletAddress } = req.body;
        
        if (!blobId || !walletAddress) {
            return res.status(400).json({
                error: 'Blob ID and wallet address are required'
            });
        }

        // Basic Sui address validation
        const suiAddressRegex = /^0x[a-fA-F0-9]{64}$/;
        if (!suiAddressRegex.test(walletAddress)) {
            return res.status(400).json({
                error: 'Invalid Sui wallet address format'
            });
        }

        const deleted = await db.deleteAsset(blobId, walletAddress);
        
        if (deleted) {
            res.status(200).json({
                success: true,
                message: 'Asset record deleted successfully from database',
                note: 'Data still exists on Walrus network'
            });
        } else {
            res.status(404).json({
                error: 'Asset not found or you do not have permission to delete it'
            });
        }
    } catch (error) {
        console.error('Error in delete asset endpoint:', error);
        res.status(500).json({
            error: 'Failed to delete asset record'
        });
    }
});

// 404 handler
app.use('/{*any}', (req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});


// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to get started`);
});

export default app;
