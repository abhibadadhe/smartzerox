import React, { useState } from 'react';
import { Settings, Save, CheckCircle, FileText } from 'lucide-react';
import { shopAPI } from '../../lib/api';
import { toast } from 'sonner';

const OTP_PLACEMENT_OPTIONS = [
  {
    value: 'first_page',
    label: 'First Page',
    description: 'Print OTP on the first page only',
  },
  {
    value: 'last_page',
    label: 'Last Page',
    description: 'Print OTP on the last page only',
  },
  {
    value: 'all_pages',
    label: 'All Pages',
    description: 'Print OTP on every page',
  },
  {
    value: 'extra_page',
    label: 'Extra Page',
    description: 'Append a separate page with the OTP printed on it',
  },
];

const ShopProfile = ({ shopData, setShopData }) => {
  const [pricing, setPricing] = useState({
    bw: {
      singleSided: shopData?.pricing?.bw?.singleSided || 2,
      doubleSided: shopData?.pricing?.bw?.doubleSided || 3,
    },
    color: {
      singleSided: shopData?.pricing?.color?.singleSided || 10,
      doubleSided: shopData?.pricing?.color?.doubleSided || 15,
    },
  });

  const [profile, setProfile] = useState({
    name: shopData?.name || '',
    phone: shopData?.phone || '',
    address: {
      street: shopData?.address?.street || '',
      city: shopData?.address?.city || '',
      state: shopData?.address?.state || '',
      pincode: shopData?.address?.pincode || '',
    },
    upiId: shopData?.upiId || '',
    razorpayAccountId: shopData?.razorpayAccountId || '',
    splitPaymentEnabled: shopData?.splitPaymentEnabled !== false,
    bankDetails: {
      accountHolderName: shopData?.bankDetails?.accountHolderName || '',
      accountNumber: shopData?.bankDetails?.accountNumber || '',
      ifscCode: shopData?.bankDetails?.ifscCode || '',
      bankName: shopData?.bankDetails?.bankName || '',
    },
  });

  const [otpPlacement, setOtpPlacement] = useState(
    shopData?.otpPlacement || 'all_pages'
  );

  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updateData = {
        name: profile.name,
        phone: profile.phone,
        address: profile.address,
        upiId: profile.upiId,
        razorpayAccountId: profile.razorpayAccountId,
        splitPaymentEnabled: profile.splitPaymentEnabled,
        bankDetails: profile.bankDetails,
        pricing,
        otpPlacement,
      };
      const res = await shopAPI.updateShop(updateData);
      setShopData(res.data.data.shop);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      toast.success('Profile updated successfully');
    } catch (err) {
      console.error('Failed to update profile:', err);
      toast.error('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Shop Profile & Settings</h2>
        <p className="text-gray-500 text-sm mt-1">Manage your shop details and pricing</p>
      </div>

      {/* ── Pricing ─────────────────────────────────────────────────────────── */}
      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
        <h3 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2 flex items-center gap-2">
          <Settings size={20} className="text-gray-500" />
          Pricing Configuration
        </h3>

        <div className="space-y-6">
          {/* B&W Pricing */}
          <div>
            <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-gray-800"></span>
              Black & White Printing
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                  Single Sided (₹)
                </label>
                <input
                  type="number"
                  value={pricing.bw.singleSided}
                  onChange={(e) =>
                    setPricing((prev) => ({
                      ...prev,
                      bw: { ...prev.bw, singleSided: Number(e.target.value) },
                    }))
                  }
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500 p-2 border"
                  min="0"
                  step="0.5"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                  Double Sided (₹)
                </label>
                <input
                  type="number"
                  value={pricing.bw.doubleSided}
                  onChange={(e) =>
                    setPricing((prev) => ({
                      ...prev,
                      bw: { ...prev.bw, doubleSided: Number(e.target.value) },
                    }))
                  }
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500 p-2 border"
                  min="0"
                  step="0.5"
                />
              </div>
            </div>
          </div>

          {/* Color Pricing */}
          <div>
            <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-gradient-to-r from-blue-400 via-pink-500 to-yellow-500"></span>
              Color Printing
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                  Single Sided (₹)
                </label>
                <input
                  type="number"
                  value={pricing.color.singleSided}
                  onChange={(e) =>
                    setPricing((prev) => ({
                      ...prev,
                      color: { ...prev.color, singleSided: Number(e.target.value) },
                    }))
                  }
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500 p-2 border"
                  min="0"
                  step="0.5"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                  Double Sided (₹)
                </label>
                <input
                  type="number"
                  value={pricing.color.doubleSided}
                  onChange={(e) =>
                    setPricing((prev) => ({
                      ...prev,
                      color: { ...prev.color, doubleSided: Number(e.target.value) },
                    }))
                  }
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500 p-2 border"
                  min="0"
                  step="0.5"
                />
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── OTP Print Placement ──────────────────────────────────────────────── */}
      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
        <h3 className="text-lg font-bold text-gray-800 mb-1 border-b pb-2 flex items-center gap-2">
          <FileText size={20} className="text-gray-500" />
          OTP Print Placement
        </h3>
        <p className="text-sm text-gray-500 mb-4 mt-2">
          Choose which page the order OTP is stamped on when printing.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {OTP_PLACEMENT_OPTIONS.map((opt) => {
            const isSelected = otpPlacement === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setOtpPlacement(opt.value)}
                className={`text-left p-4 rounded-lg border-2 transition-colors ${
                  isSelected
                    ? 'border-orange-500 bg-orange-50'
                    : 'border-gray-200 hover:border-orange-300 hover:bg-orange-50/40'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                      isSelected
                        ? 'border-orange-500 bg-orange-500'
                        : 'border-gray-400'
                    }`}
                  />
                  <span
                    className={`font-semibold text-sm ${
                      isSelected ? 'text-orange-700' : 'text-gray-700'
                    }`}
                  >
                    {opt.label}
                  </span>
                </div>
                <p className="text-xs text-gray-500 ml-6">{opt.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Shop Information ─────────────────────────────────────────────────── */}
      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
        <h3 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2">Shop Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              Shop Name
            </label>
            <input
              type="text"
              value={profile.name}
              onChange={(e) => setProfile((prev) => ({ ...prev, name: e.target.value }))}
              className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500 p-2 border"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              Phone Number
            </label>
            <input
              type="text"
              value={profile.phone}
              onChange={(e) => setProfile((prev) => ({ ...prev, phone: e.target.value }))}
              className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500 p-2 border"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              Street Address
            </label>
            <input
              type="text"
              value={profile.address.street}
              onChange={(e) =>
                setProfile((prev) => ({
                  ...prev,
                  address: { ...prev.address, street: e.target.value },
                }))
              }
              className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500 p-2 border"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              City
            </label>
            <input
              type="text"
              value={profile.address.city}
              onChange={(e) =>
                setProfile((prev) => ({
                  ...prev,
                  address: { ...prev.address, city: e.target.value },
                }))
              }
              className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500 p-2 border"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              State
            </label>
            <input
              type="text"
              value={profile.address.state}
              onChange={(e) =>
                setProfile((prev) => ({
                  ...prev,
                  address: { ...prev.address, state: e.target.value },
                }))
              }
              className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500 p-2 border"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              Pincode
            </label>
            <input
              type="text"
              value={profile.address.pincode}
              onChange={(e) =>
                setProfile((prev) => ({
                  ...prev,
                  address: { ...prev.address, pincode: e.target.value },
                }))
              }
              className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500 p-2 border"
            />
          </div>
        </div>
      </div>

      {/* ── Payout Details ───────────────────────────────────────────────────── */}
      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
        <h3 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2">Payout Details</h3>
        <p className="text-sm text-gray-500 mb-4">
          Add your UPI ID or Bank Account to receive withdrawals.
        </p>

        <div className="space-y-6">
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              UPI ID
            </label>
            <input
              type="text"
              placeholder="e.g. 9876543210@ybl"
              value={profile.upiId}
              onChange={(e) => setProfile((prev) => ({ ...prev, upiId: e.target.value }))}
              className="w-full md:w-1/2 border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500 p-2 border"
            />
          </div>

          <div className="pt-4 border-t border-gray-50">
            <h4 className="font-medium text-gray-700 mb-3">Bank Transfer Details (Optional)</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                  Account Holder Name
                </label>
                <input
                  type="text"
                  value={profile.bankDetails.accountHolderName}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      bankDetails: { ...prev.bankDetails, accountHolderName: e.target.value },
                    }))
                  }
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500 p-2 border"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                  Bank Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. HDFC Bank"
                  value={profile.bankDetails.bankName}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      bankDetails: { ...prev.bankDetails, bankName: e.target.value },
                    }))
                  }
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500 p-2 border"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                  Account Number
                </label>
                <input
                  type="text"
                  value={profile.bankDetails.accountNumber}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      bankDetails: { ...prev.bankDetails, accountNumber: e.target.value },
                    }))
                  }
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500 p-2 border"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                  IFSC Code
                </label>
                <input
                  type="text"
                  value={profile.bankDetails.ifscCode}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      bankDetails: { ...prev.bankDetails, ifscCode: e.target.value },
                    }))
                  }
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500 p-2 border"
                />
              </div>
            </div>
          </div>

          {/* ── Razorpay Route Direct Split Payment ────────────────────────── */}
          <div className="pt-4 border-t border-gray-50">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h4 className="font-medium text-gray-700 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500"></span>
                  Razorpay Route (Direct Payment Split)
                </h4>
                <p className="text-xs text-gray-500 mt-0.5">
                  When enabled, printing earnings go directly to your linked account on order placement; ₹1 platform fee goes to Admin.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={profile.splitPaymentEnabled}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      splitPaymentEnabled: e.target.checked,
                    }))
                  }
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
              </label>
            </div>

            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                Razorpay Linked Account ID (e.g. acc_xxxxxxxxxxxx)
              </label>
              <input
                type="text"
                placeholder="e.g. acc_Lz89abc1234567"
                value={profile.razorpayAccountId}
                onChange={(e) =>
                  setProfile((prev) => ({
                    ...prev,
                    razorpayAccountId: e.target.value,
                  }))
                }
                className="w-full md:w-1/2 border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500 p-2 border font-mono text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">
                Generated from Razorpay Dashboard → Route → Linked Accounts.
              </p>
            </div>
          </div>
        </div>
      </div>
      {/* ── Save Changes ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 pt-2 pb-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-orange-500 text-white px-6 py-2 rounded-lg font-medium hover:bg-orange-600 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : <><Save size={18} /> Save Changes</>}
        </button>
        {success && (
          <span className="flex items-center gap-1 text-green-600 font-medium animate-fade-in-out">
            <CheckCircle size={18} /> Saved successfully
          </span>
        )}
      </div>
    </div>
  );
};

export default ShopProfile;
