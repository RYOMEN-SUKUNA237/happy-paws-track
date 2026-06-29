import React, { useState } from 'react';
import { 
  UserPlus, Search, Filter, MoreVertical, Copy, Download, CheckCircle,
  Bike, Car, Truck as TruckIcon, X, RefreshCw, Eye, ChevronDown, Loader2
} from 'lucide-react';
import { Courier, generateCourierId } from './types';
import Barcode from '../../components/ui/Barcode';
import * as api from '../../services/api';

interface CouriersProps {
  couriers: Courier[];
  setCouriers: React.Dispatch<React.SetStateAction<Courier[]>>;
  onRefresh: () => void;
}

const vehicleIcons: Record<string, React.ReactNode> = {
  motorcycle: <Bike size={16} />,
  car: <Car size={16} />,
  van: <Car size={16} />,
  truck: <TruckIcon size={16} />,
  bicycle: <Bike size={16} />,
};

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  inactive: 'bg-gray-100 text-gray-600',
  'on-delivery': 'bg-blue-100 text-blue-700',
  'on-break': 'bg-amber-100 text-amber-700',
};

const Couriers: React.FC<CouriersProps> = ({ couriers, setCouriers, onRefresh }) => {
  const [showForm, setShowForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedCourier, setSelectedCourier] = useState<Courier | null>(null);
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [copied, setCopied] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', vehicleType: 'van' as Courier['vehicleType'],
    licensePlate: '', zone: '',
  });
  const [generatedId, setGeneratedId] = useState('');

  const handleGenerateId = () => {
    setGeneratedId(generateCourierId());
  };

  const [saving, setSaving] = useState(false);

  const handleRegister = async () => {
    if (!formData.name || !formData.email || !formData.phone) return;
    setSaving(true);
    try {
      const res = await api.couriers.create({
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        vehicle_type: formData.vehicleType,
        license_plate: formData.licensePlate,
        zone: formData.zone,
      });
      const c = res.courier;
      const newCourier: Courier = {
        id: c.id.toString(),
        courierId: c.courier_id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        vehicleType: c.vehicle_type,
        licensePlate: c.license_plate || '',
        zone: c.zone || '',
        status: c.status,
        registeredAt: c.created_at?.split('T')[0] || '',
        totalDeliveries: 0,
        rating: 5.0,
        avatar: c.avatar || '',
      };
      setFormData({ name: '', email: '', phone: '', vehicleType: 'van', licensePlate: '', zone: '' });
      setGeneratedId(c.courier_id);
      setShowForm(false);
      setSelectedCourier(newCourier);
      setShowBarcodeModal(true);
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to register courier.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleToggleStatus = async (courier: Courier) => {
    const newStatus = courier.status === 'inactive' ? 'active' : 'inactive';
    try {
      await api.couriers.updateStatus(courier.courierId, newStatus);
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to update status.');
    }
  };

  const filtered = couriers.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.courierId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.zone.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#0a192f]">Courier Management</h2>
          <p className="text-sm text-gray-500">{couriers.length} registered couriers</p>
        </div>
        <button
          onClick={() => { setShowForm(true); handleGenerateId(); }}
          className="px-5 py-2.5 bg-[#0a192f] text-white text-sm font-medium rounded-lg hover:bg-[#112d57] transition-colors flex items-center gap-2 self-start sm:self-auto"
        >
          <UserPlus size={16} /> Register Courier
        </button>
      </div>

      {/* Registration Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-[#0a192f]">Register New Courier</h3>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              {/* Generated ID */}
              <div className="bg-[#0a192f] text-white p-4 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-300 uppercase tracking-wider font-medium">Courier ID (Auto-Generated)</span>
                  <button onClick={handleGenerateId} className="text-xs text-blue-300 hover:text-white flex items-center gap-1 transition-colors">
                    <RefreshCw size={12} /> Regenerate
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xl sm:text-2xl font-mono font-bold tracking-wider">{generatedId || '—'}</span>
                  {generatedId && (
                    <button onClick={() => handleCopyId(generatedId)} className="p-1.5 bg-white/10 rounded hover:bg-white/20 transition-colors">
                      {copied ? <CheckCircle size={16} className="text-green-400" /> : <Copy size={16} />}
                    </button>
                  )}
                </div>
                {generatedId && (
                  <div className="mt-3 flex justify-center bg-white/10 rounded p-3">
                    <Barcode value={generatedId} width={220} height={50} />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Full Name *</label>
                  <input
                    type="text" value={formData.name}
                    onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))}
                    placeholder="John Smith"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Email *</label>
                  <input
                    type="email" value={formData.email}
                    onChange={(e) => setFormData(p => ({ ...p, email: e.target.value }))}
                    placeholder="john@happypawstransit.com"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Phone *</label>
                  <input
                    type="tel" value={formData.phone}
                    onChange={(e) => setFormData(p => ({ ...p, phone: e.target.value }))}
                    placeholder="+1 555-0100"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Vehicle Type</label>
                  <select
                    value={formData.vehicleType}
                    onChange={(e) => setFormData(p => ({ ...p, vehicleType: e.target.value as Courier['vehicleType'] }))}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none bg-white"
                  >
                    <option value="motorcycle">Motorcycle</option>
                    <option value="bicycle">Bicycle</option>
                    <option value="car">Car</option>
                    <option value="van">Van</option>
                    <option value="truck">Truck</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">License Plate</label>
                  <input
                    type="text" value={formData.licensePlate}
                    onChange={(e) => setFormData(p => ({ ...p, licensePlate: e.target.value }))}
                    placeholder="TX-1234-AB"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Assigned Zone</label>
                  <input
                    type="text" value={formData.zone}
                    onChange={(e) => setFormData(p => ({ ...p, zone: e.target.value }))}
                    placeholder="Downtown Houston"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowForm(false)} className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleRegister}
                  disabled={!formData.name || !formData.email || !formData.phone || !generatedId}
                  className="flex-1 px-4 py-2.5 bg-[#0a192f] text-white text-sm font-medium rounded-lg hover:bg-[#112d57] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Register & Generate Barcode
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Barcode Modal */}
      {showBarcodeModal && selectedCourier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowBarcodeModal(false)}>
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 text-center space-y-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle size={32} className="text-green-600" />
              </div>
              <h3 className="text-lg font-bold text-[#0a192f]">Courier Registered Successfully!</h3>
              <p className="text-sm text-gray-500">{selectedCourier.name} has been registered.</p>
              
              <div className="bg-gray-50 rounded-lg p-5 space-y-3">
                <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Courier ID & Barcode</p>
                <div className="flex justify-center">
                  <Barcode value={selectedCourier.courierId} width={250} height={65} />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => handleCopyId(selectedCourier.courierId)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                >
                  <Copy size={14} /> {copied ? 'Copied!' : 'Copy ID'}
                </button>
                <button
                  onClick={() => setShowBarcodeModal(false)}
                  className="flex-1 px-4 py-2.5 bg-[#0a192f] text-white text-sm font-medium rounded-lg hover:bg-[#112d57] transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text" value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, ID, or zone..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none"
          />
        </div>
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="appearance-none pl-4 pr-10 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] outline-none bg-white"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="on-delivery">On Delivery</option>
            <option value="on-break">On Break</option>
            <option value="inactive">Inactive</option>
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {/* Courier Table */}
      <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50/80 border-b border-gray-100">
                <th className="text-left px-4 sm:px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Courier</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">ID</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Vehicle</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">Zone</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Deliveries</th>
                <th className="text-right px-4 sm:px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((courier) => (
                <tr key={courier.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 sm:px-6 py-4">
                    <div className="flex items-center gap-3">
                      <img src={courier.avatar} alt={courier.name} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#0a192f] truncate">{courier.name}</p>
                        <p className="text-xs text-gray-400 truncate">{courier.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 hidden md:table-cell">
                    <span className="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-1 rounded">{courier.courierId}</span>
                  </td>
                  <td className="px-4 py-4 hidden lg:table-cell">
                    <div className="flex items-center gap-2 text-sm text-gray-600 capitalize">
                      {vehicleIcons[courier.vehicleType]} {courier.vehicleType}
                    </div>
                  </td>
                  <td className="px-4 py-4 hidden sm:table-cell">
                    <span className="text-sm text-gray-600">{courier.zone}</span>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full capitalize ${statusColors[courier.status]}`}>
                      {courier.status.replace('-', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-4 hidden lg:table-cell">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[#0a192f]">{courier.totalDeliveries}</span>
                      <span className="text-xs text-yellow-600">★ {courier.rating}</span>
                    </div>
                  </td>
                  <td className="px-4 sm:px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => { setSelectedCourier(courier); setShowBarcodeModal(true); }}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 hover:text-[#0a192f]"
                        title="View Barcode"
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        onClick={() => handleCopyId(courier.courierId)}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 hover:text-[#0a192f]"
                        title="Copy ID"
                      >
                        <Copy size={16} />
                      </button>
                      <button
                        onClick={() => handleToggleStatus(courier)}
                        className={`p-2 hover:bg-gray-100 rounded-lg transition-colors text-xs font-medium ${
                          courier.status === 'inactive' ? 'text-green-600' : 'text-red-500'
                        }`}
                        title={courier.status === 'inactive' ? 'Activate' : 'Deactivate'}
                      >
                        {courier.status === 'inactive' ? 'Activate' : 'Deactivate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-sm text-gray-400">
                    No couriers found matching your criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Couriers;
