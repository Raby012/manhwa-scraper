const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes);

app.get('/', (req, res) => {
  res.json({
    status: 'running',
    endpoints: {
      latest: '/api/latest/:page',
      all: '/api/all/:page',
      search: '/api/search?q=title',
      info: '/api/info/:slug',
      chapter: '/api/chapter/:slug'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
