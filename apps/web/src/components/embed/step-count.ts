/**
 * T-172: can the request form say how many steps it has before a service is chosen?
 *
 * The Questions step exists only for a service that asks something: the
 * business's questions for every service, that service's own questions, or
 * its quantity. On the first step (choose a service) nothing is chosen yet,
 * so the form counted without Questions and read "Step 1 of 4", then
 * "Step 2 of 5" once a service with questions was picked.
 *
 * The total is known on the first step when every service leads to a
 * Questions step, or none does. (A form with one service has no first step
 * to choose on, so it was always right.) When some do and some do not, the
 * first step shows its name only, and the count starts on the second step.
 */

export interface StepCountService {
  id: string
  measurementModel: { type: string; askCustomerForQuantity: boolean } | null
}

export interface StepCountData {
  services: StepCountService[]
  /** @deprecated older responses carry the business-wide questions here */
  fields?: unknown[]
  globalFields?: unknown[]
  serviceFields?: Record<string, unknown[]>
}

/** Does choosing this service lead to a Questions step? */
export function serviceAsksQuestions(data: StepCountData, service: StepCountService): boolean {
  const forEveryService = (data.globalFields || data.fields || []).length
  const itsOwn = (data.serviceFields?.[service.id] || []).length
  const asksQuantity = service.measurementModel?.type === 'per_unit' && service.measurementModel.askCustomerForQuantity
  return forEveryService + itsOwn > 0 || Boolean(asksQuantity)
}

/** 'every': each service has a Questions step; 'none': no service has; 'some': it depends on the choice */
export type QuestionsSpread = 'every' | 'none' | 'some'

export function questionsSpread(data: StepCountData): QuestionsSpread {
  const asking = data.services.filter((service) => serviceAsksQuestions(data, service)).length
  if (asking === 0) return 'none'
  return asking === data.services.length ? 'every' : 'some'
}
