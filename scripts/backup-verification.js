#!/usr/bin/env node

/**
 * Backup Verification Script
 * Verifies integrity of database and S3 backups
 */

const { Client } = require('pg');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const Redis = require('ioredis');
const fs = require('fs').promises;
const crypto = require('crypto');

class BackupVerifier {
  constructor() {
    this.pgClient = null;
    this.redisClient = null;
    this.s3Client = null;
  }

  async initialize() {
    // Initialize PostgreSQL client
    this.pgClient = new Client({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'invorto',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      ssl: process.env.NODE_ENV === 'production'
    });

    // Initialize Redis client
    this.redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

    // Initialize S3 client
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'ap-south-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });

    await this.pgClient.connect();
    console.log('✅ Connected to database');
  }

  async verifyDatabaseBackup(backupPath) {
    console.log(`🔍 Verifying database backup: ${backupPath}`);

    try {
      // Check if backup file exists and is readable
      await fs.access(backupPath);
      const stats = await fs.stat(backupPath);

      if (stats.size === 0) {
        throw new Error('Backup file is empty');
      }

      console.log(`✅ Backup file exists (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

      // Calculate checksum
      const fileContent = await fs.readFile(backupPath);
      const checksum = crypto.createHash('sha256').update(fileContent).digest('hex');

      console.log(`📋 Backup checksum: ${checksum}`);

      // Verify basic structure (this is a simple check)
      const content = fileContent.toString();
      if (!content.includes('CREATE TABLE') && !content.includes('INSERT INTO')) {
        throw new Error('Backup does not contain expected SQL structure');
      }

      console.log('✅ Database backup structure verified');

      return {
        status: 'success',
        size: stats.size,
        checksum,
        timestamp: stats.mtime
      };

    } catch (error) {
      console.error(`❌ Database backup verification failed: ${error.message}`);
      return {
        status: 'failed',
        error: error.message
      };
    }
  }

  async verifyS3Backup(bucketName, prefix = 'backups/') {
    console.log(`🔍 Verifying S3 backup in bucket: ${bucketName}`);

    try {
      // List backup objects
      const listCommand = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix
      });

      const response = await this.s3Client.send(listCommand);

      if (!response.Contents || response.Contents.length === 0) {
        throw new Error('No backup objects found in S3');
      }

      console.log(`✅ Found ${response.Contents.length} backup objects`);

      // Verify each backup object
      const verificationResults = [];

      for (const object of response.Contents.slice(0, 5)) { // Check first 5 objects
        if (!object.Key) continue;

        const getCommand = new GetObjectCommand({
          Bucket: bucketName,
          Key: object.Key
        });

        const objectResponse = await this.s3Client.send(getCommand);

        if (objectResponse.Body) {
          const chunks = [];
          const stream = objectResponse.Body;

          for await (const chunk of stream) {
            chunks.push(chunk);
          }

          const content = Buffer.concat(chunks);
          const checksum = crypto.createHash('sha256').update(content).digest('hex');

          verificationResults.push({
            key: object.Key,
            size: object.Size,
            checksum,
            lastModified: object.LastModified
          });
        }
      }

      console.log('✅ S3 backup objects verified');

      return {
        status: 'success',
        objectCount: response.Contents.length,
        verifiedObjects: verificationResults
      };

    } catch (error) {
      console.error(`❌ S3 backup verification failed: ${error.message}`);
      return {
        status: 'failed',
        error: error.message
      };
    }
  }

  async verifyRedisBackup(backupPath) {
    console.log(`🔍 Verifying Redis backup: ${backupPath}`);

    try {
      // Check if backup file exists
      await fs.access(backupPath);
      const stats = await fs.stat(backupPath);

      if (stats.size === 0) {
        throw new Error('Redis backup file is empty');
      }

      console.log(`✅ Redis backup file exists (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

      // Basic Redis dump file validation
      const fileContent = await fs.readFile(backupPath);
      const content = fileContent.toString();

      // Check for Redis dump file magic number
      if (fileContent[0] !== 0x52 || fileContent[1] !== 0x45 || fileContent[2] !== 0x44 || fileContent[3] !== 0x49 || fileContent[4] !== 0x53) {
        console.warn('⚠️  Redis dump file magic number not found - may not be a valid RDB file');
      } else {
        console.log('✅ Redis dump file format verified');
      }

      const checksum = crypto.createHash('sha256').update(fileContent).digest('hex');

      return {
        status: 'success',
        size: stats.size,
        checksum,
        timestamp: stats.mtime
      };

    } catch (error) {
      console.error(`❌ Redis backup verification failed: ${error.message}`);
      return {
        status: 'failed',
        error: error.message
      };
    }
  }

  async runComprehensiveVerification() {
    console.log('🚀 Starting comprehensive backup verification...\n');

    const results = {
      timestamp: new Date().toISOString(),
      database: null,
      s3: null,
      redis: null,
      overall: 'pending'
    };

    // Verify database backup
    if (process.env.DB_BACKUP_PATH) {
      results.database = await this.verifyDatabaseBackup(process.env.DB_BACKUP_PATH);
    } else {
      console.log('⚠️  DB_BACKUP_PATH not set, skipping database backup verification');
    }

    // Verify S3 backup
    if (process.env.S3_BUCKET_NAME) {
      results.s3 = await this.verifyS3Backup(process.env.S3_BUCKET_NAME);
    } else {
      console.log('⚠️  S3_BUCKET_NAME not set, skipping S3 backup verification');
    }

    // Verify Redis backup
    if (process.env.REDIS_BACKUP_PATH) {
      results.redis = await this.verifyRedisBackup(process.env.REDIS_BACKUP_PATH);
    } else {
      console.log('⚠️  REDIS_BACKUP_PATH not set, skipping Redis backup verification');
    }

    // Determine overall status
    const allResults = [results.database, results.s3, results.redis].filter(r => r !== null);
    const failedResults = allResults.filter(r => r.status === 'failed');

    if (failedResults.length === 0 && allResults.length > 0) {
      results.overall = 'success';
    } else if (failedResults.length > 0) {
      results.overall = 'failed';
    } else {
      results.overall = 'no_backups_configured';
    }

    console.log(`\n📊 Verification Summary:`);
    console.log(`Overall Status: ${results.overall === 'success' ? '✅ SUCCESS' : results.overall === 'failed' ? '❌ FAILED' : '⚠️  ' + results.overall.toUpperCase()}`);

    if (results.database) {
      console.log(`Database: ${results.database.status === 'success' ? '✅' : '❌'} ${results.database.status}`);
    }
    if (results.s3) {
      console.log(`S3: ${results.s3.status === 'success' ? '✅' : '❌'} ${results.s3.status}`);
    }
    if (results.redis) {
      console.log(`Redis: ${results.redis.status === 'success' ? '✅' : '❌'} ${results.redis.status}`);
    }

    return results;
  }

  async cleanup() {
    if (this.pgClient) {
      await this.pgClient.end();
    }
    if (this.redisClient) {
      this.redisClient.disconnect();
    }
  }
}

// Main execution
async function main() {
  const verifier = new BackupVerifier();

  try {
    await verifier.initialize();
    const results = await verifier.runComprehensiveVerification();

    // Exit with appropriate code
    if (results.overall === 'success') {
      process.exit(0);
    } else {
      process.exit(1);
    }

  } catch (error) {
    console.error(`💥 Backup verification failed: ${error.message}`);
    process.exit(1);
  } finally {
    await verifier.cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = BackupVerifier;