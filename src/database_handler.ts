import  sqlite3  from "sqlite3";


const TABLE_NAME = "user";
const ASSETS_TABLE_NAME = "assets";

export interface User {
    address: string,
    steamID: number
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
}

export class Database {
    rawDb: sqlite3.Database;

    constructor(filename: string) {
        this.rawDb = new sqlite3.Database(filename);
        this.initializeAssetTable();
    }

    /**
     * Initialize the assets table if it doesn't exist
     */
    private initializeAssetTable(): void {
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
    addRow(address: string, steamID: number): void {
        this.rawDb.exec(
            `INSERT INTO ${TABLE_NAME} VALUES ('${address}', ${steamID})`,
            (err: Error | null) => {
                console.error(err)
            }
        )
    }

    /**
     * Get steamID from address
     */
    getSteamID(address: string): number | undefined {
        let result;
        this.rawDb.get(
            `SELECT steam_id FROM ${TABLE_NAME} WHERE address = ${address}`,
            (err: Error | null, row: User) => {
                if (row)
                    result = row.address;
            }
        );

        return result;
    }

    /**
     * Add a new asset record to the database
     */
    addAsset(assetRecord: AssetRecord): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const insertQuery = `
                INSERT INTO ${ASSETS_TABLE_NAME} 
                (walletAddress, blobId, appid, assetid, classid, instanceid, contextid, amount, icon_url, uploadedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
}
