/**
 * OPFS (Origin Private File System) Manager
 * Handles storing and retrieving files from the browser's private file system
 * This allows storing large files without keeping them in RAM
 */

export interface OPFSFileMetadata {
    name: string;
    size: number;
    type: string;
    lastModified: number;
    opfsPath: string;
}

export class OPFSManager {
    private root: FileSystemDirectoryHandle | null = null;
    private initialized = false;
    private initPromise: Promise<void> | null = null;


    /**
     * Initialize OPFS access
     * Must be called before using other methods
     */
    async init(): Promise<void> {
        // If already initialized, return immediately
        if (this.initialized && this.root) {
            return;
        }

        // If initialization is in progress, wait for it
        if (this.initPromise) {
            return this.initPromise;
        }

        // Start initialization and store the promise
        this.initPromise = (async () => {
            try {
                // Use the static method instead of duplicating the check
                if (OPFSManager.isSupported()) {
                    this.root = await navigator.storage.getDirectory();
                    this.initialized = true;
                } else {
                    throw new Error('OPFS is not supported in this browser');
                }
            } catch (error) {
                console.error('Failed to initialize OPFS:', error);
                this.initPromise = null; // Reset on error so it can retry
                throw new Error('OPFS initialization failed. Your browser may not support it.');
            }
        })();

        return this.initPromise;
    }

    /**
     * Store a file in OPFS
     * @param file - The file to store
     * @param path - Optional custom path. If not provided, uses file name
     * @returns The path where the file was stored
     */
    async storeFile(file: File, path?: string): Promise<string> {

        if (!this.initialized) {
            await this.init();
        }

        if (!this.root) {
            throw new Error('OPFS not initialized');
        }

        // Use provided path or generate one from file name
        const filePath = path || `files/${Date.now()}-${file.name}`;

        try {
            // Create directory structure if needed
            const pathParts = filePath.split('/');
            let currentDir = this.root;

            // Navigate/create directories
            for (let i = 0; i < pathParts.length - 1; i++) {
                const dirName = pathParts[i];
                currentDir = await currentDir.getDirectoryHandle(dirName, { create: true });
            }

            // Create file handle
            const fileName = pathParts[pathParts.length - 1];
            const fileHandle = await currentDir.getFileHandle(fileName, { create: true });

            // Write file data
            const writable = await fileHandle.createWritable();
            await writable.write(file);
            await writable.close();

            return filePath;
        } catch (error) {
            console.error('Failed to store file in OPFS:', error);
            throw new Error(`Failed to store file: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Retrieve a file from OPFS
     * @param path - The path to the file
     * @returns The file
     */
    async getFile(path: string): Promise<File> {
        if (!this.initialized) {
            await this.init();
        }

        if (!this.root) {
            throw new Error('OPFS not initialized');
        }

        try {
            const pathParts = path.split('/');
            let currentDir = this.root;

            // Navigate to file's directory
            for (let i = 0; i < pathParts.length - 1; i++) {
                currentDir = await currentDir.getDirectoryHandle(pathParts[i]);
            }

            // Get file
            const fileName = pathParts[pathParts.length - 1];
            const fileHandle = await currentDir.getFileHandle(fileName);
            return await fileHandle.getFile();
        } catch (error) {
            console.error('Failed to retrieve file from OPFS:', error);
            throw new Error(`File not found: ${path}`);
        }
    }

    /**
     * Check if a file exists in OPFS
     * @param path - The path to check
     * @returns True if file exists
     */
    async fileExists(path: string): Promise<boolean> {
        try {
            await this.getFile(path);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Delete a file from OPFS
     * @param path - The path to the file
     */
    async deleteFile(path: string): Promise<void> {
        if (!this.initialized) {
            await this.init();
        }

        if (!this.root) {
            throw new Error('OPFS not initialized');
        }

        try {
            const pathParts = path.split('/');
            let currentDir = this.root;

            // Navigate to file's directory
            for (let i = 0; i < pathParts.length - 1; i++) {
                currentDir = await currentDir.getDirectoryHandle(pathParts[i]);
            }

            // Delete file
            const fileName = pathParts[pathParts.length - 1];
            await currentDir.removeEntry(fileName);
        } catch (error) {
            console.error('Failed to delete file from OPFS:', error);
            throw new Error(`Failed to delete file: ${path}`);
        }
    }

    /**
     * Delete a directory and all its contents from OPFS
     * @param path - The path to the directory
     */
    async deleteDirectory(path: string): Promise<void> {
        if (!this.initialized) {
            await this.init();
        }

        if (!this.root) {
            throw new Error('OPFS not initialized');
        }

        try {
            const pathParts = path.split('/');
            let parentDir = this.root;

            // Navigate to the parent directory
            for (let i = 0; i < pathParts.length - 1; i++) {
                parentDir = await parentDir.getDirectoryHandle(pathParts[i]);
            }

            // Delete the directory recursively
            const dirName = pathParts[pathParts.length - 1];
            await parentDir.removeEntry(dirName, { recursive: true });
        } catch (error) {
            console.error('Failed to delete directory from OPFS:', error);
            throw new Error(`Failed to delete directory: ${path}`);
        }
    }

    /**
     * Get metadata about a stored file
     * @param path - The path to the file
     * @returns File metadata
     */
    async getFileMetadata(path: string): Promise<OPFSFileMetadata> {
        const file = await this.getFile(path);
        return {
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            opfsPath: path,
        };
    }

    /**
     * Check if OPFS is supported in the current browser
     */
    static isSupported(): boolean {
        return (
            'storage' in navigator &&
            'getDirectory' in navigator.storage &&
            typeof navigator.storage.getDirectory === 'function'
        );
    }
}

// Singleton instance
export const opfsManager = new OPFSManager();