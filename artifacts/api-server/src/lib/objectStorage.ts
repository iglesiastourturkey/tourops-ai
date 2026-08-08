import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { File, Storage } from '@google-cloud/storage';

import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
} from './objectAcl';

function loadServiceAccountCredentials(): Record<string, unknown> {
  const raw = process.env.GCS_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      'GCS_SERVICE_ACCOUNT_KEY not set. Provide the GCS service-account key JSON ' +
        '(as a string) in this env var.',
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('GCS_SERVICE_ACCOUNT_KEY is not valid JSON.');
  }
}

// Lazily constructed so that importing this module (e.g. transitively, via
// route registration at server startup) doesn't require GCS credentials to
// be configured — only actually using object storage does.
let _objectStorageClient: Storage | null = null;

function getObjectStorageClient(): Storage {
  if (!_objectStorageClient) {
    _objectStorageClient = new Storage({ credentials: loadServiceAccountCredentials() });
  }
  return _objectStorageClient;
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || '';
    const paths = Array.from(
      new Set(
        pathsStr
          .split(',')
          .map((path) => path.trim())
          .filter((path) => path.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        'PUBLIC_OBJECT_SEARCH_PATHS not set. Set it to a comma-separated list of ' +
          'GCS paths to search for public objects (e.g. "/my-bucket/public").',
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || '';
    if (!dir) {
      throw new Error(
        'PRIVATE_OBJECT_DIR not set. Set it to the GCS path used for private ' +
          'object storage (e.g. "/my-bucket/private").',
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = getObjectStorageClient().bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(
    file: File,
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === 'public';

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      'Content-Type':
        (metadata.contentType as string) || 'application/octet-stream',
      'Cache-Control': `${isPublic ? 'public' : 'private'}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers['Content-Length'] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const { uploadURL } = await this.getObjectEntityUploadInfo();
    return uploadURL;
  }

  /**
   * Generate a presigned PUT URL for a new private object upload.
   *
   * Returns BOTH the signed URL (for the client PUT) AND the canonical
   * `/objects/uploads/<uuid>` object path (for storage in the DB).
   * The object path is derived directly from the UUID — never by parsing the
   * signed URL — so it is stable regardless of the signed-URL provider format.
   */
  async getObjectEntityUploadInfo(): Promise<{ uploadURL: string; objectPath: string }> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        'PRIVATE_OBJECT_DIR not set. Set it to the GCS path used for private ' +
          'object storage (e.g. "/my-bucket/private").',
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    const uploadURL = await signObjectURL({
      bucketName,
      objectName,
      method: 'PUT',
      ttlSec: 900,
    });

    // Build the canonical path from the UUID directly — do NOT parse the
    // signed URL, which may use a different base depending on the provider.
    const objectPath = `/objects/uploads/${objectId}`;

    return { uploadURL, objectPath };
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith('/objects/')) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split('/');
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join('/');
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith('/')) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = getObjectStorageClient().bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith('https://storage.googleapis.com/')) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith('/')) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  /**
   * Upload a Buffer directly to private object storage.
   *
   * @param key  Relative path within PRIVATE_OBJECT_DIR (e.g. "field-notes/op-1/photo.jpg")
   * @param buffer  Raw file data
   * @param contentType  MIME type (e.g. "image/jpeg")
   * @returns  Canonical objectPath (`/objects/<key>`) suitable for storing in the DB
   */
  async uploadFile(key: string, buffer: Buffer, contentType: string): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const fullPath = `${privateObjectDir}/${key}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const bucket = getObjectStorageClient().bucket(bucketName);
    const file = bucket.file(objectName);
    await file.save(buffer, { contentType, resumable: false });
    return `/objects/${key}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith('/')) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  const pathParts = path.split('/');
  if (pathParts.length < 3) {
    // Path doesn't embed a bucket segment (e.g. PRIVATE_OBJECT_DIR configured
    // as just "/uploads" instead of "/<bucket>/uploads") — fall back to a
    // default bucket if one is configured.
    const defaultBucket = process.env.GCS_BUCKET_NAME;
    if (defaultBucket && pathParts[1]) {
      return { bucketName: defaultBucket, objectName: pathParts.slice(1).join('/') };
    }
    throw new Error(
      'Invalid path: must contain at least a bucket name, or set GCS_BUCKET_NAME as a default bucket.',
    );
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join('/');

  return {
    bucketName,
    objectName,
  };
}

const SIGN_ACTION: Record<'GET' | 'PUT' | 'DELETE' | 'HEAD', 'read' | 'write' | 'delete'> = {
  GET: 'read',
  HEAD: 'read',
  PUT: 'write',
  DELETE: 'delete',
};

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  ttlSec: number;
}): Promise<string> {
  const file = getObjectStorageClient().bucket(bucketName).file(objectName);
  const [signedURL] = await file.getSignedUrl({
    version: 'v4',
    action: SIGN_ACTION[method],
    expires: Date.now() + ttlSec * 1000,
  });
  return signedURL;
}
