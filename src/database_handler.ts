import  sqlite3  from "sqlite3";


const TABLE_NAME = "user";
const ASSETS_TABLE_NAME = "assets";

export interface User {
    address: string,
    steamID: string
}

export interface AssetRecord {
    id?: number;
    walletAddress: string;
    blobId: string;
    appid: number;
    assetid: string;
    classid: string;
    instanceid: string;
    contextid: string;
    amount: string;
    icon_url: string;
    name: string;
    price: string;
    description?: string;
    uploadedAt: string;
}

export interface SteamAssetResponse {
    appid: number;
    contextid: string;
    assetid: string;
    classid: string;
    instanceid: string;
    amount: string;
}

export interface SteamDescriptionResponse {
    appid: number;
    classid: string;
    instanceid: string;
    icon_url: string;
    market_hash_name?: string;
    name?: string;
    type?: string;
    [key: string]: any; // Allow for other properties
}

export interface SteamInventoryResponse {
    assets?: SteamAssetResponse[];
    descriptions?: SteamDescriptionResponse[];
    success: number;
    error?: string;
}

export interface SteamInventoryItem {
    appid: number;
    contextid: string;
    assetid: string;
    classid: string;
    instanceid: string;
    amount: string;
    icon_url: string;
    name: string;
}


export class Database {
    rawDb: sqlite3.Database;

    constructor(filename: string) {
        this.rawDb = new sqlite3.Database(filename);
        this.initializeUserTable();
        this.initializeAssetsTable();
    }

    /**
     * Initialize the user table if it doesn't exist
     */
    private initializeUserTable(): void {
        const createUserTable = `
            CREATE TABLE IF NOT EXISTS user (
                address TEXT PRIMARY KEY,
                steamID TEXT
            )
        `;
        this.rawDb.exec(createUserTable, (err: Error | null) => {
            if (err) {
                console.error('Error creating user table:', err);
            } else {
                console.log('User table initialized successfully');
            }
        });
    }

    /**
     * Initialize the assets table if it doesn't exist
     */
    private initializeAssetsTable(): void {
        const createAssetsTable = `
            CREATE TABLE IF NOT EXISTS ${ASSETS_TABLE_NAME} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                walletAddress TEXT NOT NULL,
                blobId TEXT NOT NULL UNIQUE,
                appid INTEGER NOT NULL,
                assetid TEXT NOT NULL,
                classid TEXT NOT NULL,
                instanceid TEXT NOT NULL,
                contextid TEXT NOT NULL,
                amount TEXT NOT NULL,
                icon_url TEXT NOT NULL,
                name TEXT NOT NULL,
                price TEXT NOT NULL,
                description TEXT,
                uploadedAt TEXT NOT NULL,
                UNIQUE(walletAddress, assetid)
            )
        `;
        this.rawDb.exec(createAssetsTable, (err: Error | null) => {
            if (err) {
                console.error('Error creating assets table:', err);
            } else {
                console.log('Assets table initialized successfully');
            }
        });
    }

    /**
     * Add a new row with address (hex) and steamID (decimal)
     */
    addRow(address: string, steamID: string, callback: (err: Error | null) => void): void {
        if (!address) {
            callback(new Error('Address is required for addRow'));
            return;
        }
        const normalizedAddress = address.trim().toLowerCase();
        const insertQuery = `INSERT INTO ${TABLE_NAME} (address, steamID) VALUES (?, ?)`;
        console.log('[addRow] SQL:', insertQuery, 'Params:', [normalizedAddress, steamID]);
        this.rawDb.run(
            insertQuery,
            [normalizedAddress, steamID],
            (err: Error | null) => {
                callback(err);
            }
        );
    }

    /**
     * Get steamID from address
     */
    getSteamID(address: string, callback: (err: Error | null, steamID?: string) => void): void {
        if (!address) {
            callback(new Error('Address is required for getSteamID'));
            return;
        }
        const normalizedAddress = address.trim().toLowerCase();
        const selectQuery = `SELECT steamID FROM ${TABLE_NAME} WHERE address = ?`;
        console.log('[getSteamID] SQL:', selectQuery, 'Params:', [normalizedAddress]);
        this.rawDb.get(
            selectQuery,
            [normalizedAddress],
            (err: Error | null, row: User) => {
                if (err) return callback(err);
                callback(null, row ? String(row.steamID) : undefined);
            }
        );
    }

    /**
     * Add a new asset record to the database
     */
    addAsset(assetRecord: AssetRecord): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const insertQuery = `
                INSERT INTO ${ASSETS_TABLE_NAME} 
                (walletAddress, blobId, appid, assetid, classid, instanceid, contextid, amount, icon_url, name, price, description, uploadedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            this.rawDb.run(
                insertQuery,
                [
                    assetRecord.walletAddress,
                    assetRecord.blobId,
                    assetRecord.appid,
                    assetRecord.assetid,
                    assetRecord.classid,
                    assetRecord.instanceid,
                    assetRecord.contextid,
                    assetRecord.amount,
                    assetRecord.icon_url,
                    assetRecord.name,
                    assetRecord.price,
                    assetRecord.description || null,
                    assetRecord.uploadedAt
                ],
                function(err: Error | null) {
                    if (err) {
                        console.error('Error adding asset:', err);
                        reject(err);
                    } else {
                        console.log('Asset added successfully with ID:', this.lastID);
                        resolve(true);
                    }
                }
            );
        });
    }

    /**
     * Get all assets for a specific wallet address
     */
    getAssetsByWallet(walletAddress: string): Promise<AssetRecord[]> {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM ${ASSETS_TABLE_NAME} 
                WHERE walletAddress = ? 
                ORDER BY uploadedAt DESC
            `;
            
            this.rawDb.all(query, [walletAddress], (err: Error | null, rows: AssetRecord[]) => {
                if (err) {
                    console.error('Error fetching assets by wallet:', err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    /**
     * Get all assets (with optional pagination)
     */
    getAllAssets(limit?: number, offset?: number): Promise<AssetRecord[]> {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT * FROM ${ASSETS_TABLE_NAME} 
                ORDER BY uploadedAt DESC
            `;
            
            const params: any[] = [];
            if (limit) {
                query += ' LIMIT ?';
                params.push(limit);
                if (offset) {
                    query += ' OFFSET ?';
                    params.push(offset);
                }
            }
            
            this.rawDb.all(query, params, (err: Error | null, rows: AssetRecord[]) => {
                if (err) {
                    console.error('Error fetching all assets:', err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    /**
     * Get asset by blob ID
     */
    getAssetByBlobId(blobId: string): Promise<AssetRecord | null> {
        return new Promise((resolve, reject) => {
            const query = `SELECT * FROM ${ASSETS_TABLE_NAME} WHERE blobId = ?`;
            
            this.rawDb.get(query, [blobId], (err: Error | null, row: AssetRecord) => {
                if (err) {
                    console.error('Error fetching asset by blob ID:', err);
                    reject(err);
                } else {
                    resolve(row || null);
                }
            });
        });
    }

    /**
     * Delete an asset record
     */
    deleteAsset(blobId: string, walletAddress: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const query = `
                DELETE FROM ${ASSETS_TABLE_NAME} 
                WHERE blobId = ? AND walletAddress = ?
            `;
            
            this.rawDb.run(query, [blobId, walletAddress], function(err: Error | null) {
                if (err) {
                    console.error('Error deleting asset:', err);
                    reject(err);
                } else {
                    resolve(this.changes > 0);
                }
            });
        });
    }

    /**
     * Get all users in the database
     */
    getAllUsers(): Promise<User[]> {
        return new Promise((resolve, reject) => {
            const query = `SELECT * FROM ${TABLE_NAME}`;
            this.rawDb.all(query, [], (err: Error | null, rows: User[]) => {
                if (err) {
                    console.error('Error fetching all users:', err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }
}
