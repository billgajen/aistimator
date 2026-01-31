# tickets/T-012-uploads-photos-and-documents.md

## Goal
Implement file upload pipeline for photos and documents.

## In scope
- Public endpoint: `POST /api/public/uploads/init`
- Direct upload to R2 using signed URLs
- Client-side image compression/resizing before upload (basic)
- Store assets rows in DB
- Attach `assetIds` to quote submission

## Out of scope
- OCR
- Virus scanning (v2)

## Acceptance criteria
- [x] Upload init returns signed PUT URLs and assetIds
- [x] Widget uploads multiple photos and documents successfully
- [x] Uploaded assets are private and retrievable only via controlled URLs later

## Completed
- 2026-01-25: File upload pipeline implementation complete

  **R2 Integration:**
  - Created `apps/web/src/lib/r2.ts` - R2 client using AWS S3 SDK
    - `generateUploadUrl(key, contentType)` - Signed PUT URLs for direct upload
    - `generateDownloadUrl(key)` - Signed GET URLs for private access
    - `isR2Configured()` - Check if R2 env vars are set
  - Added `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` dependencies

  **Upload Init Endpoint (`POST /api/public/uploads/init`):**
  - Now returns real R2 signed URLs when R2 is configured
  - Fallback to local endpoint for development without R2
  - Creates asset records in DB before returning URLs
  - Validates file types (images: jpeg, png, webp, heic, heif; docs: pdf)
  - Validates file sizes (images: 10MB, docs: 25MB)

  **Asset View Endpoint (`GET /api/public/assets/:assetId`):**
  - Redirects to R2 signed download URL when R2 is configured
  - Token validation ensures only quote viewers can access assets
  - Returns metadata for development without R2

  **Widget File Upload (iframe mode):**
  - New `FileUploadStep` component in `/embed/[tenantKey]`
  - Shows between Details and Contact steps
  - Grid layout with image thumbnails
  - PDF documents shown with icon and filename
  - Upload progress with spinner overlay
  - Error handling with retry option
  - Remove button on uploaded files
  - Minimum photos validation (configurable per tenant)
  - Limits enforced: maxPhotos, maxDocs from widget config

  **Image Utilities (`apps/web/src/lib/image-utils.ts`):**
  - `compressImage()` - Client-side resize/compress before upload
  - `formatFileSize()` - Human-readable file sizes
  - `isAllowedFileType()` - File type validation

  **Progress Indicator:**
  - Updated to show 4 steps when file uploads enabled: Service → Details → Photos → Contact
  - Adapts based on tenant's widget_config settings

  **Environment Variables (updated `.env.example`):**
  ```
  R2_ACCOUNT_ID=your-account-id
  R2_ACCESS_KEY_ID=your-r2-access-key
  R2_SECRET_ACCESS_KEY=your-r2-secret-key
  R2_BUCKET_NAME=estimator-assets
  ```

  **Note:** Standalone JS widget (`packages/widget`) does not include file upload to keep bundle small. Use iframe mode for file upload support.