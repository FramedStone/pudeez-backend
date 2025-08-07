import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import session from 'express-session';
import SQLiteStoreFactory from 'connect-sqlite3';

// Extend express-session types to include walletAddress
import 'express-session';
declare module 'express-session' {
  interface SessionData {
    walletAddress?: string;
  }
}
import passport from 'passport';
import SteamStrategy from 'passport-steam';

import { Database, User, AssetRecord, SteamInventoryResponse } from './database_handler';
import { SteamAsset, storeAssetOnWalrus, retrieveAssetFromWalrus } from './walrus_handler';
import { randomUUID } from 'crypto';

// Temporary in-memory token store for walletAddress
const steamLoginTokenMap = new Map<string, string>();

// Steam user profile interface
interface SteamProfile {
  id: string;
  displayName: string;
  profileUrl: string;
  photos: Array<{ value: string }>;
  _json: Record<string, unknown>;
}

// Get env vars
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3111;
const DB_NAME = "data.sqlite3";

// Steam API key validation
const STEAM_API_KEY = process.env.STEAM_API_KEY;
if (!STEAM_API_KEY) {
  console.warn('STEAM_API_KEY is not set in environment variables. Steam authentication will not work.');
}

// Initialize database
const db = new Database(DB_NAME);

// Configure passport for Steam authentication
passport.serializeUser((user: unknown, done) => done(null, user));
passport.deserializeUser((obj: unknown, done) => done(null, obj as Express.User));

if (STEAM_API_KEY) {
  passport.use(new SteamStrategy(
    {
      returnURL: `http://localhost:${PORT}/auth/steam/return`,
      realm: `http://localhost:${PORT}/`,
      apiKey: STEAM_API_KEY,
    },
    function (identifier, profile, done) {
      // profile.id is the SteamID
      return done(null, profile);
    }
  ));
}

// -- Middlewares --
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Persistent session store using SQLite
const SQLiteStore = SQLiteStoreFactory(session);
app.use(session({ 
  store: new SQLiteStore({ db: 'sessions.sqlite3', dir: './' }) as any,
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production', 
  resave: false, 
  saveUninitialized: true,
  cookie: {
    secure: false, // Set to true if using HTTPS
    sameSite: 'lax', // Use 'none' and secure: true if using HTTPS and cross-site
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// CORS middleware
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
if (FRONTEND_URL === '*') {
  console.warn('CORS is set to allow all origins. Set FRONTEND_URL in your environment for better security.');
}
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', FRONTEND_URL);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
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
app.get('/test/getAllUsers', async (req: Request, res: Response) => {
  try {
    const users = await db.getAllUsers();
    res.status(200).json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});
// Steam Authentication Routes
app.get('/auth/steam/login', (req: Request, res: Response, next: NextFunction) => {
    if (!STEAM_API_KEY) {
        return res.status(500).json({ 
            error: 'Steam authentication is not configured. STEAM_API_KEY is missing.' 
        });
    }
    const { walletAddress } = req.query;
    if (!walletAddress || typeof walletAddress !== 'string') {
        return res.status(400).json({ error: 'walletAddress is required as a query parameter' });
    }
    // Generate a random token and store the mapping
    const token = randomUUID();
    steamLoginTokenMap.set(token, walletAddress);
    // Redirect to Steam login with token as query param
    const redirectUrl = `/auth/steam?token=${encodeURIComponent(token)}`;
    res.redirect(redirectUrl);
});

// passport-steam default route 
app.get('/auth/steam', (req, res, next) => {
    const token = req.query.token as string | undefined;
    const returnURL = token
        ? `http://localhost:${PORT}/auth/steam/return/${encodeURIComponent(token)}`
        : `http://localhost:${PORT}/auth/steam/return`;
    console.log('[DEBUG] passport-steam returnURL:', returnURL);
    passport.authenticate('steam', { returnURL } as any)(req, res, next);
});

app.get('/auth/steam/return',
    passport.authenticate('steam', { failureRedirect: '/auth/steam/error' }),
    async (req: Request, res: Response) => {
        const steamUser = req.user as SteamProfile;
        const steamId = steamUser?.id;
        
        console.log('Steam authentication successful:', {
            steamId: steamId,
            displayName: steamUser?.displayName,
            photos: steamUser?.photos
        });
        
        // Redirect to frontend after successful Steam authentication, passing steamId and displayName
        const redirectUrl = `${FRONTEND_URL}/?steamId=${encodeURIComponent(steamId ?? '')}&displayName=${encodeURIComponent(steamUser?.displayName ?? '')}`;
        res.redirect(redirectUrl);
        // res.json({
        //     success: true,
        //     message: 'Steam authentication successful',
        //     steamId: steamId,
        //     displayName: steamUser?.displayName,
        //     profileUrl: steamUser?.profileUrl,
        //     avatar: steamUser?.photos?.[0]?.value
        // });
    }
);

app.get('/auth/steam/error', (req: Request, res: Response) => {
    res.status(401).json({ 
        error: 'Steam authentication failed',
        message: 'Unable to authenticate with Steam. Please try again.'
    });
});

// Insert new address & steamID pair from user
app.post('/api/user/add', (req: Request, res: Response) => {
    const userData = req.body as User;
    db.addRow(userData.address, String(userData.steamID), (err: Error | null) => {
        if (err) {
            console.error('Error adding user:', err);
            if ((err as any).code === 'SQLITE_CONSTRAINT') {
                res.status(409).json({ success: false, error: 'User address already exists', details: err.message });
            } else {
                res.status(500).json({ success: false, error: 'Failed to add user', details: err.message });
            }
        } else {
            console.log('User added successfully:', userData);
            res.status(200).json({ success: true, message: 'User added successfully' });
        }
    });
});

app.post('/api/user/get_steamid', (req: Request, res: Response) => {
    const address = req.body.address;
    console.log('[get_steamid] Received address:', address);
    db.getSteamID(address, (err: Error | null, steamID?: string) => {
        if (err) {
            console.error('[get_steamid] DB error:', err);
            return res.status(500).json({ error: err.message });
        }
        console.log('[get_steamid] Returning steamID:', steamID, 'for address:', address);
        res.status(200).json({ steamID });
    });
})

// Get Steam inventory for a user
app.get('/api/steam/inventory/:steamID', async (req: Request, res: Response) => {
    try {
        const { steamID } = req.params;
        const appid = req.query.appid ? parseInt(req.query.appid as string) : 730;
        const contextid = req.query.contextid ? parseInt(req.query.contextid as string) : 2;

        // Validate steamID (should be numeric)
        if (!steamID || !/^\d+$/.test(steamID)) {
            return res.status(400).json({
                error: 'Invalid Steam ID format. Must be numeric.'
            });
        }

        const steamApiUrl = `https://steamcommunity.com/inventory/${steamID}/${appid}/${contextid}`;
        
        console.log(`Fetching Steam inventory from: ${steamApiUrl}`);
        
        // Add proper headers to mimic browser request
        const response = await axios.get<SteamInventoryResponse>(steamApiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'Referer': `https://steamcommunity.com/profiles/${steamID}/inventory/`
            },
            timeout: 10000 // 10 second timeout
        });
        
        const inventoryData = response.data;

        if (!inventoryData.success || inventoryData.success !== 1) {
            return res.status(404).json({
                error: inventoryData.error || 'Steam inventory not found or private'
            });
        }

        // Merge assets and descriptions for frontend
        const assets = (inventoryData.assets || []).map(asset => {
            // Find matching description by classid and instanceid
            const desc = (inventoryData.descriptions || []).find(d =>
                d.classid === asset.classid && d.instanceid === asset.instanceid
            );
            return {
                assetid: asset.assetid,
                classid: asset.classid,
                instanceid: asset.instanceid,
                contextid: asset.contextid,
                appid: asset.appid,
                amount: asset.amount,
                icon_url: desc?.icon_url || '',
                name: desc?.name || desc?.market_hash_name || '',
                type: desc?.type || '',
                // Add more fields if needed
            };
        });

        res.json({ assets });
    } catch (error) {
        console.error('Error fetching Steam inventory:', error);
        
        if (axios.isAxiosError(error)) {
            if (error.response?.status === 401) {
                return res.status(403).json({
                    error: 'Steam inventory is private or requires authentication'
                });
            } else if (error.response?.status === 403) {
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

// List Steam asset data on Walrus
app.post('/api/walrus/list', async (req: Request, res: Response) => {
    try {
        const assetData = req.body as SteamAsset;
        
        // Validate required fields
        if (!assetData.appid || !assetData.assetid || !assetData.walletAddress || !assetData.icon_url || !assetData.name || !assetData.price) {
            return res.status(400).json({ 
                error: 'Missing required fields: appid, assetid, walletAddress, icon_url, name, and price are required' 
            });
        }

        // Basic Sui address validation (0x followed by 64 hex characters)
        const suiAddressRegex = /^0x[a-fA-F0-9]{64}$/;
        if (!suiAddressRegex.test(assetData.walletAddress)) {
            return res.status(400).json({
                error: 'Invalid Sui wallet address format. Must be 0x followed by 64 hex characters'
            });
        }

        // Validate price format (should be a valid number in MIST)
        const priceNumber = parseFloat(assetData.price);
        if (isNaN(priceNumber) || priceNumber < 0) {
            return res.status(400).json({
                error: 'Invalid price format. Price must be a valid non-negative number in MIST'
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
                name: assetData.name,
                price: assetData.price,
                uploadedAt: new Date().toISOString()
            };

            try {
                await db.addAsset(assetRecord);
                res.status(200).json({
                    success: true,
                    blobId: blobId,
                    walletAddress: assetData.walletAddress,
                    message: 'Asset data listed successfully on Walrus and database'
                });
            } catch (dbError) {
                console.error('Error storing asset in database:', dbError);
                // Still return success since Walrus storage worked
                res.status(200).json({
                    success: true,
                    blobId: blobId,
                    walletAddress: assetData.walletAddress,
                    message: 'Asset data listed on Walrus but failed to update database',
                    warning: 'Database update failed'
                });
            }
        } else {
            res.status(500).json({
                error: 'Failed to list asset data on Walrus'
            });
        }
    } catch (error) {
        console.error('Error in walrus list endpoint:', error);
        res.status(500).json({
            error: 'Internal server error while listing asset data'
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
