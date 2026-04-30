async function testLogin() {
  try {
    const res = await fetch('http://localhost:5000/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@almarkazia.com',
        password: 'admin123'
      })
    });
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Success:', data.success);
    if (data.data) {
      console.log('Token:', data.data.accessToken.substring(0, 10) + '...');
    } else {
      console.log('Error:', JSON.stringify(data.error));
    }
  } catch (err) {
    console.log('Fetch Error:', err.message);
  }
}

testLogin();
