const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');  
const XLSX = require('xlsx');

const app = express();
const port = 3000;

// --- Middleware Setup ---
app.use(cors());
app.use(express.json());

// --- Database Connection ---
const mongoURI = 'mongodb://127.0.0.1:27017/BioGas';

mongoose.connect(mongoURI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => {
   console.error('MongoDB connection error:', err);
   process.exit(1);
   });

// --- Mongoose Schema and Model ---
const sensorSchema = new mongoose.Schema({
  ph: Number,
  pressure1: Number,
  pressure2: Number,
  pressure3: Number,
  temperature: Number,
  timestamp: {
    type: Date,
    default: Date.now,
  },
});
const SensorData = mongoose.model('SensorData', sensorSchema);

// --- Routes ---
app.get('/',(req,res,next)=>{
  res.send('<h1>BioGas Monitoring Server Running</h1>');
})

// Route to save incoming sensor data (used by ESP8266)
app.post('/sensorData', async (req, res) => {
  try {
    const sensorData = new SensorData(req.body);
    await sensorData.save();
    console.log('Saved sensor data:', sensorData);
    res.status(200).send({ status: 'success', message: 'Data saved to MongoDB' });
  } catch (error) {
    console.error('Error saving data:', error);
    res.status(500).send({ status: 'error', message: 'Failed to save data' });
  }
});

// Route to fetch latest sensor data (used by React app)
app.get('/sensorData', async (req, res) => {
  try {
    // Fetches the last 100 entries for real-time display
    const data = await SensorData.find().sort({ timestamp: -1 }).limit(100);
    res.json(data);
  } catch (error) {
    console.error('Error fetching data:', error);
    res.status(500).send({ status: 'error', message: 'Failed to fetch data' });
  }
});

/**
 * UPDATED ROUTE: Exports all data from the last 10 minutes to an XLSX file
 * and then deletes those records from MongoDB.
 */
app.get('/export-and-delete', async (req, res) => {
  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const dataToExport = await SensorData.find({ timestamp: { $gte: tenMinutesAgo } })
      .sort({ timestamp: 1 })
      .lean();

    if (dataToExport.length === 0) {
      return res.status(200).json({
        status: 'info',
        message: 'No new data found in the last 10 minutes to export.'
      });
    }

    const cleanData = dataToExport.map(({ _id, __v, ...rest }) => rest);

    const worksheet = XLSX.utils.json_to_sheet(cleanData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'SensorData');
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, '-').split('T').join('_');
    const filename = `BioGas_Data_Export_${dateStr}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Send the file
    res.end(buffer);

    // Delete after sending completes
    res.on('finish', async () => {
      const deleteResult = await SensorData.deleteMany({
        _id: { $in: dataToExport.map(d => d._id) }
      });
      console.log(`[EXPORT] Successfully deleted ${deleteResult.deletedCount} documents.`);
    });

    res.on('error', (err) => {
      console.error('[EXPORT ERROR] Failed to send file:', err);
    });

  } catch (error) {
    console.error('[EXPORT ERROR] Error during export and delete process:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to complete data export and deletion.'
    });
  }
});

// --- Server Listener ---
app.listen(port, '0.0.0.0', () => console.log(`Server running on http://172.16.125.23:${port}`));

// Note: Remember to address the firewall issue on the server machine (172.16.125.219)
// by ensuring TCP port 3000 is open for incoming connections.
