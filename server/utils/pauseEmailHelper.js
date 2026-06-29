/**
 * pauseEmailHelper.js
 * Professional, category-specific hold messaging for shipment pause emails.
 * Imported by mailer.js — DO NOT rename without updating that import.
 */

const COMPANY_EMAIL_REF = process.env.COMPANY_EMAIL || 'support@happypawstransit.com';
const COMPANY_PHONE_REF = '+1 (412) 227-3484';

/**
 * Returns professional copy for each pause category.
 * @param {string} pauseCategory
 * @param {string|null} location  — where the parcel is held
 */
function getPauseCategoryContent(pauseCategory, location) {
  const cat = (pauseCategory || '').toLowerCase();
  const held = location ? `at <strong>${location}</strong>` : 'at an intermediary transit facility';

  if (cat.includes('transit stop') || cat.includes('layover')) {
    return {
      emoji: '✈️',
      label: 'Aircraft Transit Stop',
      color: '#0284c7',
      headline: 'Aircraft Landed for Scheduled Transit Layover',
      body: `We wish to inform you that the aircraft transporting your shipment has landed ${held} for a scheduled transit layover. This stop is a planned part of the flight plan for logistics operations, refueling, cargo sorting, and flight clearance procedures.<br><br>
      The cargo remains secure on board the aircraft or within the airport's secure transit zone. The flight will resume its journey to the final destination once all standard transit procedures are completed.`,
      action: 'No action is required from you. The shipment will resume active flight status shortly.',
      urgency: null,
    };
  }

  if (cat.includes('custom')) {
    return {
      emoji: '🛃',
      label: 'Customs & Import Clearance Hold',
      color: '#7c3aed',
      headline: 'Your shipment is currently being processed by Customs authorities',
      body: `We wish to inform you that your shipment is presently held ${held} pending customs clearance. This is a standard regulatory procedure required by the import authorities of the destination country. Our logistics team is actively liaising with the relevant customs officials to expedite the release of your cargo.<br><br>
      You may be required to furnish additional documentation such as a commercial invoice, certificate of origin, packing list, or import permits. Please contact us immediately if you have received any communication from customs authorities, or if you require assistance preparing the necessary paperwork.`,
      action: 'Our compliance team will notify you as soon as your shipment has been cleared and is ready to continue its journey.',
      urgency: 'Please respond promptly to any customs documentation requests to avoid further delays or storage fees.',
    };
  }

  if (cat.includes('weather') || cat.includes('hazard')) {
    return {
      emoji: '🌪️',
      label: 'Severe Weather — Transit Suspended',
      color: '#0369a1',
      headline: 'Transit has been temporarily suspended due to adverse weather conditions',
      body: `The safety of your cargo and our operational staff is our absolute priority. Your shipment, currently secured ${held}, has been temporarily grounded due to adverse weather conditions along its transit route. This may include severe storms, flooding, extreme temperatures, or other weather-related hazards that make safe transit impossible at this time.<br><br>
      Our operations team is continuously monitoring meteorological forecasts and liaising with carriers, port authorities, and aviation bodies. Transit will resume at the earliest opportunity once conditions are deemed safe and operations can proceed normally.`,
      action: 'No action is required from you at this time. We will dispatch an update as soon as operations resume and your shipment is back in transit.',
      urgency: null,
    };
  }

  if (cat.includes('security') || cat.includes('inspect')) {
    return {
      emoji: '🔒',
      label: 'Security Inspection — Mandatory Hold',
      color: '#b45309',
      headline: 'Your shipment has been selected for a mandatory security inspection',
      body: `We are writing to inform you that your shipment, currently held ${held}, has been flagged for a mandatory security inspection by the relevant transport or border security authorities. This is a routine procedure applied across international shipments and does not necessarily indicate any irregularity with your cargo.<br><br>
      Our compliance team is fully cooperating with the inspecting authority to ensure the process is completed as efficiently as possible. All packaging and contents will be handled with the utmost care and professionalism. We maintain strict documentation throughout the inspection process.`,
      action: 'Transit will resume immediately upon successful completion of the security inspection and official release by the authorities.',
      urgency: 'If you believe there may be items in your shipment that require special declaration, please contact us immediately.',
    };
  }

  if (cat.includes('address') || cat.includes('delivery')) {
    return {
      emoji: '📍',
      label: 'Delivery Address Issue — Urgent Action Required',
      color: '#dc2626',
      headline: 'We are unable to complete delivery due to an address discrepancy',
      body: `Our delivery team has encountered a critical issue with the destination address for your shipment, which is currently held ${held}. The address on record is either incomplete, unverifiable, inaccessible, or does not match any registered location in our delivery network. This has prevented our courier from completing the final-mile delivery of your cargo.<br><br>
      To avoid additional storage costs and ensure your shipment reaches you without further delay, we urge you to verify and confirm your correct delivery address at the earliest opportunity. Our customer support team is standing by to assist you with this process.`,
      action: `Please contact our support team immediately at <a href="mailto:${COMPANY_EMAIL_REF}" style="color:#3b82f6;">${COMPANY_EMAIL_REF}</a> or call ${COMPANY_PHONE_REF} to confirm your delivery address.`,
      urgency: 'URGENT: Failure to respond within 48 hours may result in the shipment being returned to sender or held in storage at additional cost.',
    };
  }

  if (cat.includes('vehicle') || cat.includes('mechanical') || cat.includes('breakdown')) {
    return {
      emoji: '🔧',
      label: 'Vehicle Mechanical Issue — Transit Paused',
      color: '#374151',
      headline: 'Transit has been paused due to an unexpected vehicle mechanical issue',
      body: `We regret to inform you that the vehicle responsible for transporting your shipment has encountered a mechanical issue during transit. Your shipment is currently secured ${held} while our operations team arranges a replacement vehicle or alternative carrier. The physical integrity and security of your cargo remains our top priority throughout this process.<br><br>
      Our fleet management and logistics coordinators are working urgently to reassign your shipment to an alternative transport solution with minimal disruption to the overall delivery schedule. Full safety protocols are being observed.`,
      action: 'We anticipate transit will resume shortly. A revised estimated delivery date will be communicated to you as soon as a replacement carrier has been confirmed.',
      urgency: null,
    };
  }

  if (cat.includes('transit') || cat.includes('delay') || cat.includes('congestion')) {
    return {
      emoji: '⏱️',
      label: 'Transit Delay — Temporary Hold',
      color: '#0a192f',
      headline: 'Your shipment is experiencing an unexpected transit delay',
      body: `We wish to notify you that your shipment, currently held ${held}, is experiencing an unexpected delay in transit. This may be attributable to congestion at a transit hub, rescheduling of a connecting carrier, operational constraints at an intermediary facility, or port/airport backlog.<br><br>
      Our logistics team is actively coordinating with the relevant carriers, hubs, and authorities to get your shipment moving again as quickly as possible. We understand the inconvenience this may cause and sincerely apologise for the disruption to your expected delivery schedule.`,
      action: 'We will provide you with an updated estimated delivery timeline as soon as the delay is fully resolved and transit resumes.',
      urgency: null,
    };
  }

  // Default / Other
  return {
    emoji: '📋',
    label: 'Shipment Temporarily On Hold',
    color: '#374151',
    headline: 'Your shipment has been temporarily placed on hold',
    body: `We are writing to inform you that your shipment is currently on hold ${held}. Our operations team is actively reviewing the situation and working diligently to resolve it at the earliest opportunity.<br><br>
    We understand how important the timely delivery of your shipment is, and we sincerely apologise for any inconvenience this temporary hold may cause. You will receive a further update from our team as soon as the situation is resolved and transit resumes.`,
    action: 'No immediate action is required from you. Our team will be in touch with further information shortly.',
    urgency: null,
  };
}

module.exports = { getPauseCategoryContent };
