import React, {useState} from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  NapsPayClient,
  NapsError,
  receiptToPlainText,
  type PaymentResult,
} from 'react-native-tkpay-naps';

function App(): React.JSX.Element {
  const [host, setHost] = useState('192.168.24.214');
  const [amount, setAmount] = useState('100');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (message: string) => {
    setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
  };

  const testConnection = async () => {
    setLoading(true);
    addLog('Testing connection...');

    try {
      const client = new NapsPayClient({host});
      const connected = await client.testConnection();

      if (connected) {
        addLog('Connection successful!');
        Alert.alert('Success', 'Connected to terminal');
      } else {
        addLog('Connection failed');
        Alert.alert('Failed', 'Cannot connect to terminal');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      addLog(`Error: ${message}`);
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  };

  const processPayment = async () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }

    setLoading(true);
    setResult(null);
    addLog(`Processing payment: ${amountNum} MAD`);

    try {
      const client = new NapsPayClient({host});

      const paymentResult = await client.processPayment({
        amount: amountNum,
        registerId: '01',
        cashierId: '00001',
      });

      setResult(paymentResult);

      if (paymentResult.success) {
        addLog(`Payment APPROVED - STAN: ${paymentResult.stan}`);
        Alert.alert('Success', `Payment approved!\nSTAN: ${paymentResult.stan}`);
      } else {
        addLog(`Payment DECLINED: ${paymentResult.error}`);
        Alert.alert('Declined', paymentResult.error || 'Payment declined');
      }
    } catch (error) {
      if (error instanceof NapsError) {
        addLog(`NapsError [${error.code}]: ${error.message}`);
        Alert.alert('Error', `${error.code}: ${error.message}`);
      } else {
        const message = error instanceof Error ? error.message : 'Unknown error';
        addLog(`Error: ${message}`);
        Alert.alert('Error', message);
      }
    } finally {
      setLoading(false);
    }
  };

  const clearLogs = () => {
    setLogs([]);
    setResult(null);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>NAPS Pay SDK Test</Text>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Terminal IP:</Text>
          <TextInput
            style={styles.input}
            value={host}
            onChangeText={setHost}
            placeholder="192.168.24.214"
            keyboardType="numeric"
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Amount (MAD):</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            placeholder="100"
            keyboardType="decimal-pad"
          />
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.testButton]}
            onPress={testConnection}
            disabled={loading}>
            <Text style={styles.buttonText}>Test Connection</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.payButton]}
            onPress={processPayment}
            disabled={loading}>
            <Text style={styles.buttonText}>Process Payment</Text>
          </TouchableOpacity>
        </View>

        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#1976D2" />
            <Text style={styles.loadingText}>Please tap card on terminal...</Text>
          </View>
        )}

        {result && (
          <View style={styles.resultContainer}>
            <Text style={styles.resultTitle}>
              {result.success ? '✅ APPROVED' : '❌ DECLINED'}
            </Text>
            {result.stan && <Text style={styles.resultText}>STAN: {result.stan}</Text>}
            {result.maskedCardNumber && (
              <Text style={styles.resultText}>Card: {result.maskedCardNumber}</Text>
            )}
            {result.authNumber && (
              <Text style={styles.resultText}>Auth: {result.authNumber}</Text>
            )}
            {result.error && (
              <Text style={styles.errorText}>Error: {result.error}</Text>
            )}

            {result.merchantReceipt && (
              <View style={styles.receiptContainer}>
                <Text style={styles.receiptTitle}>MERCHANT RECEIPT</Text>
                <Text style={styles.receiptText}>
                  {receiptToPlainText(result.merchantReceipt)}
                </Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.logsContainer}>
          <View style={styles.logsHeader}>
            <Text style={styles.logsTitle}>Logs</Text>
            <TouchableOpacity onPress={clearLogs}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          </View>
          {logs.map((log, index) => (
            <Text key={index} style={styles.logText}>
              {log}
            </Text>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 30,
    color: '#1976D2',
  },
  inputContainer: {
    marginBottom: 15,
  },
  label: {
    fontSize: 14,
    marginBottom: 5,
    color: '#666',
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  button: {
    flex: 1,
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  testButton: {
    backgroundColor: '#757575',
  },
  payButton: {
    backgroundColor: '#1976D2',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  loadingContainer: {
    alignItems: 'center',
    marginTop: 30,
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
  resultContainer: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 15,
    marginTop: 20,
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  resultText: {
    fontSize: 14,
    marginBottom: 5,
  },
  errorText: {
    fontSize: 14,
    color: '#d32f2f',
  },
  receiptContainer: {
    backgroundColor: '#f9f9f9',
    padding: 10,
    marginTop: 10,
    borderRadius: 4,
  },
  receiptTitle: {
    fontWeight: 'bold',
    marginBottom: 5,
  },
  receiptText: {
    fontFamily: 'monospace',
    fontSize: 12,
  },
  logsContainer: {
    backgroundColor: '#263238',
    borderRadius: 8,
    padding: 15,
    marginTop: 20,
  },
  logsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  logsTitle: {
    color: '#fff',
    fontWeight: 'bold',
  },
  clearText: {
    color: '#81D4FA',
  },
  logText: {
    color: '#B0BEC5',
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
});

export default App;
