import React, { useState, useEffect } from 'react';
import { Wallet, ArrowUpRight, ArrowDownRight, Calendar, X, ExternalLink } from 'lucide-react';
import { shopAPI } from '../../lib/api';
import { toast } from 'sonner';

const ShopSettlements = ({ orders = [], shopData }) => {
  const [withdrawals, setWithdrawals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [withdrawModal, setWithdrawModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('upi');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchWithdrawals();
  }, []);

  const fetchWithdrawals = async () => {
    try {
      const res = await shopAPI.getWithdrawals();
      setWithdrawals(res.data.data.withdrawals);
    } catch (err) {
      console.error('Failed to fetch withdrawals:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async (e) => {
    e.preventDefault();
    const amount = Number(withdrawAmount);
    if (!amount || amount < 1) return toast.error('Please enter a valid amount (Min: ₹1)');
    
    setSubmitting(true);
    try {
      await shopAPI.requestWithdrawal({ amount, paymentMethod });
      toast.success('Withdrawal requested successfully!');
      setWithdrawModal(false);
      setWithdrawAmount('');
      fetchWithdrawals();
      // To strictly update balance in parent, you could trigger a shopData refresh
      // but shopData.availableBalance usually requires a page reload or a callback.
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to request withdrawal');
    } finally {
      setSubmitting(false);
    }
  };
  // Compute real data from orders
  const pickedUpOrders = orders.filter(o => o.status === 'picked_up').sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const totalEarnings = shopData?.totalRevenue || 0;
  
  const appliedCommissionRate = Number(
    shopData?.effectiveCommissionRate ?? 
    shopData?.platformMargin ?? 
    shopData?.globalCommissionRate ?? 
    0
  );

  // Percentage commission due to admin (shopkeeper pays manually to admin at month-end)
  const totalCommissionDue = orders.reduce((sum, o) => {
    if (o.pricing?.percentCommission !== undefined && o.pricing?.percentCommission > 0) {
      return sum + Number(o.pricing.percentCommission);
    }
    const subtotal = Number(o.pricing?.subtotal || 0);
    const rate = Number(o.pricing?.commissionPercent || appliedCommissionRate || 0);
    return sum + (rate > 0 ? Math.round((subtotal * rate) / 100 * 100) / 100 : 0);
  }, 0);
  
  // Real available balance from backend
  const availableBalance = shopData?.availableBalance || 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Settlements & Revenue</h2>
        <p className="text-gray-500 text-sm mt-1">Track your earnings and payouts</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 p-6 rounded-xl text-white shadow-md">
          <div className="flex items-center gap-3 text-gray-300 mb-4">
            <Wallet size={20} />
            <span className="font-medium">Available Balance</span>
          </div>
          <h3 className="text-4xl font-bold mb-1">₹{availableBalance.toFixed(2)}</h3>
          <p className="text-sm text-gray-400">Next payout scheduled for tomorrow</p>
          <button 
            onClick={() => setWithdrawModal(true)}
            disabled={availableBalance < 1}
            className="mt-6 w-full py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Withdraw Funds
          </button>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex flex-col justify-center">
          <div className="flex items-center gap-3 text-gray-500 mb-2">
            <ArrowUpRight size={20} className="text-green-500" />
            <span className="font-medium">Total Earnings (All Time)</span>
          </div>
          <h3 className="text-3xl font-bold text-gray-800">₹{totalEarnings.toFixed(2)}</h3>
          <p className="text-sm text-green-600 font-medium mt-2">Based on {pickedUpOrders.length} completed orders</p>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex flex-col justify-center">
          <div className="flex items-center gap-3 text-gray-500 mb-2">
            <ArrowDownRight size={20} className="text-orange-500" />
            <span className="font-medium">Commission Due to Admin</span>
          </div>
          <h3 className="text-3xl font-bold text-gray-800">₹{totalCommissionDue.toFixed(2)}</h3>
          <p className="text-xs text-muted-foreground mt-2">
            To be paid manually to Admin at month-end ({appliedCommissionRate}% rate applied by Admin)
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
          <h3 className="font-bold text-gray-800 text-lg">Withdrawal History</h3>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs uppercase text-gray-500 tracking-wider">
                <th className="p-4 font-medium">Date</th>
                <th className="p-4 font-medium">Method</th>
                <th className="p-4 font-medium">Amount</th>
                <th className="p-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="4" className="p-8 text-center text-gray-500">Loading...</td></tr>
              ) : withdrawals.length === 0 ? (
                <tr>
                  <td colSpan="4" className="p-8 text-center text-gray-500">No withdrawals requested yet.</td>
                </tr>
              ) : (
                withdrawals.map(w => (
                  <tr key={w._id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Calendar size={16} className="text-gray-400" />
                        <span className="text-gray-600 text-sm">{new Date(w.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="text-sm font-medium text-gray-800 uppercase">{w.paymentMethod}</p>
                      <p className="text-xs text-gray-500">{w.paymentMethod === 'upi' ? w.payoutDetails?.upiId : w.payoutDetails?.accountNumber}</p>
                    </td>
                    <td className="p-4 text-sm font-bold text-gray-800">₹{w.amount.toFixed(2)}</td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                        w.status === 'completed' ? 'bg-green-100 text-green-700' :
                        w.status === 'rejected' ? 'bg-red-100 text-red-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {w.status.charAt(0).toUpperCase() + w.status.slice(1)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {/* Withdraw Modal */}
      {withdrawModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center p-6 border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-900">Withdraw Funds</h3>
              <button onClick={() => setWithdrawModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleWithdraw} className="p-6">
              <div className="mb-6 bg-orange-50 p-4 rounded-xl border border-orange-100 flex justify-between items-center">
                <span className="text-orange-800 font-medium">Available Balance</span>
                <span className="text-xl font-bold text-orange-600">₹{availableBalance.toFixed(2)}</span>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount to Withdraw (₹)</label>
                  <input
                    type="number"
                    autoFocus
                    required
                    min="1"
                    max={availableBalance}
                    placeholder="0.00"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 text-2xl font-bold text-gray-800 outline-none"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Payout Method</label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className={`cursor-pointer flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-colors ${paymentMethod === 'upi' ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <input type="radio" name="method" className="sr-only" checked={paymentMethod === 'upi'} onChange={() => setPaymentMethod('upi')} />
                      <span className={`font-medium ${paymentMethod === 'upi' ? 'text-orange-700' : 'text-gray-600'}`}>UPI</span>
                    </label>
                    <label className={`cursor-pointer flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-colors ${paymentMethod === 'bank_transfer' ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <input type="radio" name="method" className="sr-only" checked={paymentMethod === 'bank_transfer'} onChange={() => setPaymentMethod('bank_transfer')} />
                      <span className={`font-medium ${paymentMethod === 'bank_transfer' ? 'text-orange-700' : 'text-gray-600'}`}>Bank Transfer</span>
                    </label>
                  </div>
                  
                  {/* Warning if no payout details */}
                  {paymentMethod === 'upi' && !shopData?.upiId && (
                    <p className="text-red-500 text-xs mt-2 flex items-center gap-1">
                      <ExternalLink size={12} /> You have not saved a UPI ID in your Profile.
                    </p>
                  )}
                  {paymentMethod === 'bank_transfer' && !shopData?.bankDetails?.accountNumber && (
                    <p className="text-red-500 text-xs mt-2 flex items-center gap-1">
                      <ExternalLink size={12} /> You have not saved Bank Details in your Profile.
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={() => setWithdrawModal(false)}
                  className="flex-1 py-3 border border-gray-200 rounded-xl text-gray-600 font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || withdrawAmount > availableBalance || (paymentMethod === 'upi' && !shopData?.upiId) || (paymentMethod === 'bank_transfer' && !shopData?.bankDetails?.accountNumber)}
                  className="flex-1 py-3 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Processing...' : 'Confirm Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShopSettlements;
