export interface CheckoutTiming { createdAt: string; expiresAt: string }
export function affiliateGatewayExpiry(timing?: CheckoutTiming) {
  if (!timing) return {};
  const start = new Date(new Date(timing.createdAt).getTime()+7*3600000).toISOString().slice(0,19).replace('T',' ')+' +0700';
  const minutes = Math.ceil((new Date(timing.expiresAt).getTime()-new Date(timing.createdAt).getTime())/60000);
  return { expiry: { start_time: start,unit: 'minute',duration: minutes },
    custom_expiry: { order_time: start,unit: 'minute',expiry_duration: minutes } };
}
