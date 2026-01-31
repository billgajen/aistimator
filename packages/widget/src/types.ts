/**
 * Widget Types
 */

export interface WidgetConfig {
  /** Tenant key for API authentication */
  tenantKey: string

  /** Mount mode */
  mode?: 'inline' | 'floating'

  /** Container selector for inline mode */
  container?: string

  /** Pre-selected service ID */
  serviceId?: string

  /** Custom button label for floating mode */
  buttonLabel?: string

  /** Button position for floating mode */
  buttonPosition?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'

  /** Override API URL (for development) */
  apiUrl?: string
}

export interface WidgetField {
  fieldId: string
  type: 'text' | 'textarea' | 'number' | 'select' | 'radio' | 'checkbox' | 'boolean'
  label: string
  required: boolean
  options?: Array<{ value: string; label: string }>
  placeholder?: string
  helpText?: string
  /** Whether this field is critical for accurate pricing */
  criticalForPricing?: boolean
}

export interface RequiredPhotoAngle {
  id: string
  label: string
  guidance?: string
}

// Alias for use in Widget.tsx
export type FieldConfig = WidgetField

export interface WidgetFileConfig {
  minPhotos: number
  maxPhotos: number
  maxDocs: number
}

export interface ServiceMediaConfig {
  minPhotos: number
  maxPhotos: number
  photoGuidance: string | null
  requiredAngles: RequiredPhotoAngle[]
}

export interface ServiceOption {
  id: string
  name: string
  mediaConfig?: ServiceMediaConfig
}

export interface WidgetData {
  tenantName: string
  services: ServiceOption[]
  /** @deprecated Use globalFields instead. Kept for backwards compatibility. */
  fields: WidgetField[]
  /** Global fields that apply to all services (service_id = null) */
  globalFields: WidgetField[]
  /** Service-specific fields keyed by service ID */
  serviceFields: Record<string, WidgetField[]>
  files: WidgetFileConfig
}

export interface FormData {
  serviceId: string
  customer: {
    name: string
    email: string
    phone?: string
  }
  job: {
    address?: string
    postcodeOrZip?: string
    answers: Array<{ fieldId: string; value: string | number | boolean | string[] }>
  }
  assetIds: string[]
}

export interface QuoteResponse {
  quoteId: string
  status: string
  quoteViewUrl: string
  tokenExpiresAt: string
}
