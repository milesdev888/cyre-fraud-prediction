import React, { useState, useEffect } from 'react';
import { AlertTriangle, TrendingUp, Shield, Activity } from 'lucide-react';

const FraudPredictionDashboard = () => {
  const [activeTab, setActiveTab] = useState('analyze');
  const [transactionForm, setTransactionForm] = useState({
    transactionId: '',
    userId: '',
    amount: '',
    merchant: '',
    location: '',
    deviceId: ''
  });
  const [results, setResults] = useState(null);
  const [stats, setStats] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userHistory, setUserHistory] = useState(null);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

  // Fetch platform statistics
  useEffect(() => {
    fetchStatistics();
    fetchAlerts();
  }, []);

  const fetchStatistics = async () => {
    try {
      const response = await fetch(`${API_URL}/api/statistics`);
      const data = await response.json();
      setStats(data.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchAlerts = async () => {
    try {
      const response = await fetch(`${API_URL}/api/alerts`);
      const data = await response.json();
      setAlerts(data.data);
    } catch (error) {
      console.error('Error fetching alerts:', error);
    }
  };

  // Analyze transaction
  const handleAnalyzeTransaction = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transactionForm)
      });

      const data = await response.json();
      if (data.success) {
        setResults(data.data);
        fetchStatistics();
        fetchAlerts();
      }
    } catch (error) {
      console.error('Error analyzing transaction:', error);
      alert('Error analyzing transaction. Check API connection.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch user history
  const handleFetchHistory = async () => {
    if (!transactionForm.userId) {
      alert('Enter User ID first');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/user/${transactionForm.userId}/history`);
      const data = await response.json();
      if (data.success) {
        setUserHistory(data);
      }
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  };

  // Submit feedback
  const handleFeedback = async (transactionId, label) => {
    try {
      const response = await fetch(`${API_URL}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId,
          label,
          notes: label === 'fraud' ? 'Confirmed fraud' : 'False positive'
        })
      });

      const data = await response.json();
      if (data.success) {
        alert(`Feedback recorded: ${label}`);
      }
    } catch (error) {
      console.error('Error submitting feedback:', error);
    }
  };

  const getRiskColor = (riskLevel) => {
    switch (riskLevel) {
      case 'LOW':
        return 'text-green-500';
      case 'MEDIUM':
        return 'text-yellow-500';
      case 'HIGH':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  const getRiskBgColor = (riskLevel) => {
    switch (riskLevel) {
      case 'LOW':
        return 'bg-green-50 border-green-200';
      case 'MEDIUM':
        return 'bg-yellow-50 border-yellow-200';
      case 'HIGH':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-7xl mx-auto p-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Shield className="w-8 h-8 text-cyan-400" />
            <h1 className="text-4xl font-bold text-white">Fraud Prediction</h1>
          </div>
          <p className="text-gray-400">Real-time transaction fraud detection powered by AI</p>
        </div>

        {/* Stats Grid */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-slate-700 border border-slate-600 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm">Transactions Analyzed</p>
                  <p className="text-2xl font-bold text-white">{stats.totalAnalyzed}</p>
                </div>
                <Activity className="w-8 h-8 text-blue-400 opacity-50" />
              </div>
            </div>

            <div className="bg-slate-700 border border-slate-600 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm">Avg Fraud Score</p>
                  <p className="text-2xl font-bold text-white">{stats.averageFraudScore}</p>
                </div>
                <TrendingUp className="w-8 h-8 text-yellow-400 opacity-50" />
              </div>
            </div>

            <div className="bg-slate-700 border border-slate-600 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm">Flagged (High Risk)</p>
                  <p className="text-2xl font-bold text-red-400">{stats.riskDistribution.high}</p>
                </div>
                <AlertTriangle className="w-8 h-8 text-red-400 opacity-50" />
              </div>
            </div>

            <div className="bg-slate-700 border border-slate-600 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm">Accuracy Rate</p>
                  <p className="text-2xl font-bold text-green-400">{stats.accuracy}</p>
                </div>
                <Shield className="w-8 h-8 text-green-400 opacity-50" />
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b border-slate-700">
          <button
            onClick={() => setActiveTab('analyze')}
            className={`px-4 py-2 font-semibold border-b-2 transition ${
              activeTab === 'analyze'
                ? 'text-cyan-400 border-cyan-400'
                : 'text-gray-400 border-transparent hover:text-gray-300'
            }`}
          >
            Analyze Transaction
          </button>
          <button
            onClick={() => setActiveTab('alerts')}
            className={`px-4 py-2 font-semibold border-b-2 transition ${
              activeTab === 'alerts'
                ? 'text-cyan-400 border-cyan-400'
                : 'text-gray-400 border-transparent hover:text-gray-300'
            }`}
          >
            Recent Alerts
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 font-semibold border-b-2 transition ${
              activeTab === 'history'
                ? 'text-cyan-400 border-cyan-400'
                : 'text-gray-400 border-transparent hover:text-gray-300'
            }`}
          >
            User History
          </button>
        </div>

        {/* Tab Content */}
        <div className="bg-slate-700 border border-slate-600 rounded-lg p-6">
          {/* Analyze Tab */}
          {activeTab === 'analyze' && (
            <div>
              <form onSubmit={handleAnalyzeTransaction} className="space-y-4 mb-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    type="text"
                    placeholder="Transaction ID"
                    value={transactionForm.transactionId}
                    onChange={(e) => setTransactionForm({ ...transactionForm, transactionId: e.target.value })}
                    className="bg-slate-800 border border-slate-600 text-white px-4 py-2 rounded focus:outline-none focus:border-cyan-400"
                    required
                  />
                  <input
                    type="text"
                    placeholder="User ID"
                    value={transactionForm.userId}
                    onChange={(e) => setTransactionForm({ ...transactionForm, userId: e.target.value })}
                    className="bg-slate-800 border border-slate-600 text-white px-4 py-2 rounded focus:outline-none focus:border-cyan-400"
                    required
                  />
                  <input
                    type="number"
                    placeholder="Amount ($)"
                    value={transactionForm.amount}
                    onChange={(e) => setTransactionForm({ ...transactionForm, amount: parseFloat(e.target.value) })}
                    className="bg-slate-800 border border-slate-600 text-white px-4 py-2 rounded focus:outline-none focus:border-cyan-400"
                    required
                  />
                  <input
                    type="text"
                    placeholder="Merchant"
                    value={transactionForm.merchant}
                    onChange={(e) => setTransactionForm({ ...transactionForm, merchant: e.target.value })}
                    className="bg-slate-800 border border-slate-600 text-white px-4 py-2 rounded focus:outline-none focus:border-cyan-400"
                    required
                  />
                  <input
                    type="text"
                    placeholder="Location"
                    value={transactionForm.location}
                    onChange={(e) => setTransactionForm({ ...transactionForm, location: e.target.value })}
                    className="bg-slate-800 border border-slate-600 text-white px-4 py-2 rounded focus:outline-none focus:border-cyan-400"
                  />
                  <input
                    type="text"
                    placeholder="Device ID"
                    value={transactionForm.deviceId}
                    onChange={(e) => setTransactionForm({ ...transactionForm, deviceId: e.target.value })}
                    className="bg-slate-800 border border-slate-600 text-white px-4 py-2 rounded focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white px-6 py-2 rounded font-semibold transition"
                  >
                    {loading ? 'Analyzing...' : 'Analyze Transaction'}
                  </button>
                  <button
                    type="button"
                    onClick={handleFetchHistory}
                    className="bg-slate-600 hover:bg-slate-500 text-white px-6 py-2 rounded font-semibold transition"
                  >
                    User History
                  </button>
                </div>
              </form>

              {/* Results */}
              {results && (
                <div className={`border-l-4 rounded-lg p-6 ${getRiskBgColor(results.riskLevel)}`}>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-white mb-2">Analysis Result</h3>
                      <p className={`text-lg font-semibold ${getRiskColor(results.riskLevel)}`}>
                        Risk Level: {results.riskLevel}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-bold text-white">{results.fraudScore}</p>
                      <p className="text-gray-600 text-sm">Fraud Score (0-100)</p>
                    </div>
                  </div>

                  <p className="text-gray-700 mb-4">{results.recommendation}</p>

                  <div className="mb-4">
                    <h4 className="font-semibold text-white mb-2">Patterns Detected:</h4>
                    <div className="space-y-1">
                      {results.patterns.map((pattern, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${pattern.triggered ? 'bg-red-500' : 'bg-green-500'}`}></div>
                          <span className="text-sm text-gray-700">
                            {pattern.name} ({pattern.triggered ? 'Triggered' : 'Clear'})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleFeedback(results.transactionId, 'fraud')}
                      className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm font-semibold transition"
                    >
                      Mark as Fraud
                    </button>
                    <button
                      onClick={() => handleFeedback(results.transactionId, 'legitimate')}
                      className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm font-semibold transition"
                    >
                      Mark as Legitimate
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Alerts Tab */}
          {activeTab === 'alerts' && (
            <div>
              <h3 className="text-lg font-bold text-white mb-4">Recent High-Risk Alerts</h3>
              {alerts.length > 0 ? (
                <div className="space-y-4">
                  {alerts.map((alert) => (
                    <div key={alert.transactionId} className="bg-red-50 border-l-4 border-red-500 p-4 rounded">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-semibold text-gray-900">TX: {alert.transactionId}</p>
                          <p className="text-sm text-gray-600">User: {alert.userId}</p>
                        </div>
                        <span className="text-2xl font-bold text-red-600">{alert.fraudScore}</span>
                      </div>
                      
