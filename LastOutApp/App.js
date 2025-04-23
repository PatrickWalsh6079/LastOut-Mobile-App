import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Button,
  Alert,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { db } from './firebaseConfig';
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
} from 'firebase/firestore';
import './backgroundLocationTask';

const LOCATION_TASK_NAME = 'background-location-task';
const TARGET_LAT = 35.767960;
const TARGET_LON = -78.771988;
const RADIUS_METERS = 50;

const App = () => {
  const locationWatcherRef = useRef(null);
  const lastStatusRef = useRef(null);

  const [name, setName] = useState('');
  const [inputName, setInputName] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [location, setLocation] = useState(null);
  const [lastLocationTime, setLastLocationTime] = useState(null);
  const [usersLocations, setUsersLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState(null);

const sendTestNotification = async () => {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Test Notification',
      body: 'This is a test notification.',
    },
    trigger: null,
  });
};


  useEffect(() => {
    const loadUsername = async () => {
      const savedName = await AsyncStorage.getItem('username');
      if (savedName) {
        setName(savedName);
        startTracking(savedName);
      }
    };

    const registerForPushNotifications = async () => {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Notification permissions not granted');
      }
    };

    loadUsername();
    registerForPushNotifications();
  }, []);

  useEffect(() => {
    if (name) {
      startForegroundUpdates();
    }
    return () => {
      if (locationWatcherRef.current) {
        locationWatcherRef.current.remove();
      }
    };
  }, [name]);

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allEntries = [];
      let latestUserEntry = null;

      snapshot.forEach((doc) => {
        const data = doc.data();
        allEntries.push({ ...data, id: doc.id });

        if (data.name === name && !latestUserEntry) {
          latestUserEntry = data;
        }
      });

      setUsersLocations(allEntries);
      if (latestUserEntry) {
        setLocation({
          latitude: latestUserEntry.latitude,
          longitude: latestUserEntry.longitude,
        });
        setLastLocationTime(new Date(latestUserEntry.createdAt.seconds * 1000));
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, [name]);

  const startForegroundUpdates = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission to access location was denied');
      return;
    }

    if (locationWatcherRef.current) {
      await locationWatcherRef.current.remove();
    }

    locationWatcherRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Highest,
      },
      (loc) => {
        setLocation(loc.coords);
        setLastLocationTime(new Date().getTime());
        handleLocationUpdate(loc.coords);
      }
    );
  };

  const startTracking = async (userName) => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    const backgroundStatus = await Location.requestBackgroundPermissionsAsync();

    if (status !== 'granted' || backgroundStatus.status !== 'granted') {
      Alert.alert('Permission to access location was denied');
      return;
    }

    const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
    if (!hasStarted) {
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.Highest,
        showsBackgroundLocationIndicator: true,
        pausesUpdatesAutomatically: false,
        foregroundService: {
          notificationTitle: 'LastOutApp is tracking your location',
          notificationBody: 'Location tracking is active in the background.',
          notificationColor: '#0000ff',
        },
      });
    }
  };

  const handleLocationUpdate = (coords) => {
    const distance = getDistance(coords.latitude, coords.longitude, TARGET_LAT, TARGET_LON);
    const status = distance <= RADIUS_METERS ? 'In' : 'Out';

    if (lastStatusRef.current && lastStatusRef.current !== status) {
      sendStatusChangeNotification(status);
    }

    lastStatusRef.current = status;

    if (currentUserId) {
      writeLocationToFirestore(name, coords);
    } else {
      AsyncStorage.getItem('username').then((storedName) => {
        if (storedName) {
          writeLocationToFirestore(storedName, coords);
        }
      });
    }
  };

  const sendStatusChangeNotification = async (newStatus) => {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Status Changed',
        body: `You are now ${newStatus === 'In' ? 'inside' : 'outside'} the building.`,
      },
      trigger: null,
    });
  };

  const writeLocationToFirestore = async (userName, coords) => {
    try {
      const userRef = collection(db, 'users');
      await addDoc(userRef, {
        latitude: coords.latitude,
        longitude: coords.longitude,
        name: userName,
        createdAt: new Date(),
      });
      console.log(`New location added for user: ${userName}`);
    } catch (error) {
      console.error('❌ Error writing to Firestore:', error);
    }
  };

  const handleSetName = async () => {
    if (!inputName.trim()) {
      Alert.alert('Username cannot be empty');
      return;
    }

    await AsyncStorage.setItem('username', inputName.trim());
    setName(inputName.trim());
    setInputName('');
    setShowInput(false);

    if (location) {
      writeLocationToFirestore(inputName.trim(), location);
    }

    startTracking(inputName.trim());
  };

  const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const getMostRecentUserLocations = () => {
    const uniqueUsers = new Map();

    usersLocations.forEach((userLocation) => {
      const existing = uniqueUsers.get(userLocation.name);
      const newTime = new Date(userLocation.createdAt.seconds * 1000);
      const existingTime = existing ? new Date(existing.createdAt.seconds * 1000) : null;

      if (!existing || existingTime < newTime) {
        uniqueUsers.set(userLocation.name, userLocation);
      }
    });

    return Array.from(uniqueUsers.values());
  };

  const renderUserLocation = ({ item }) => {
    const status =
      getDistance(item.latitude, item.longitude, TARGET_LAT, TARGET_LON) <= RADIUS_METERS
        ? 'In ✅'
        : 'Out ❌';

    return (
      <View style={{ flex: 1, paddingHorizontal: 20 }}>
        <View
          style={{
            paddingVertical: 15,
            borderBottomWidth: 1,
            borderBottomColor: '#ddd',
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: 'bold' }}>{item.name}</Text>
          <Text>Latitude: {item.latitude}</Text>
          <Text>Longitude: {item.longitude}</Text>
          <Text>Status: {status}</Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <FlatList
        contentContainerStyle={{ flexGrow: 1 }}
        data={getMostRecentUserLocations()}
        keyExtractor={(item) => item.id}
        renderItem={renderUserLocation}
        ListHeaderComponent={
          <>
            <View
              style={{
                padding: 20,
                paddingTop: 30,
                backgroundColor: '#2596be',
                borderTopWidth: 4,
                borderTopColor: '#007AFF',
                borderRadius: 10,
                marginTop: 10,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderWidth: 2,
                borderColor: '#ccc',
                marginBottom: 0,
              }}
            >
              <Text style={{ fontSize: 20, fontWeight: '600', marginBottom: 2 }}>
                Current User: {name ? name : 'Not set'}
              </Text>
              <Image
                source={require('./images/umc.png')}
                style={{ width: 100, height: 50, borderRadius: 10 }}
              />
            </View>

            {name && location && (
              <View
                style={{
                  padding: 15,
                  backgroundColor: '#ffffff',
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: '#ddd',
                  marginTop: 0,
                }}
              >
                {usersLocations.length > 0 && (
                  <>
                    <Text>
                      Latitude: {usersLocations.find((u) => u.name === name)?.latitude ?? 'N/A'}
                    </Text>
                    <Text>
                      Longitude: {usersLocations.find((u) => u.name === name)?.longitude ?? 'N/A'}
                    </Text>
                  </>
                )}
                {lastLocationTime && (
                  <Text style={{ marginTop: 5, fontStyle: 'italic' }}>
                    Last updated at:{' '}
                    {new Date(lastLocationTime).toLocaleTimeString('en-US', {
                      timeZone: 'America/New_York',
                    })}
                  </Text>
                )}
              </View>
            )}

            <Text
              style={{
                fontSize: 20,
                fontWeight: '600',
                marginTop: 25,
                marginLeft: 15,
                marginBottom: 10,
                color: '#333',
              }}
            >
              Status of Users
            </Text>
          </>
        }
        ListFooterComponent={
          loading ? (
            <ActivityIndicator size="large" color="#0000ff" />
          ) : (
            <Text>No other user locations available.</Text>
          )
        }
      />

      <View
        style={{
          position: 'absolute',
          bottom: 20,
          right: 20,
          flexDirection: 'column',
          alignItems: 'flex-end',
          paddingRight: 10,
        }}
      >
        <TouchableOpacity
          onPress={() => {
            if (showInput) {
              setShowInput(false);
              setInputName('');
            } else {
              setShowInput(true);
            }
          }}
          style={{
            backgroundColor: showInput ? '#FF6347' : '#2596be',
            padding: 10,
            borderRadius: 5,
            marginBottom: 10,
          }}
        >
          <Text style={{ color: 'white' }}>
            {showInput ? 'Cancel' : 'Update Name'}
          </Text>
        </TouchableOpacity>

        {showInput && (
          <TextInput
            style={{
              height: 40,
              width: 200,
              borderColor: 'gray',
              borderWidth: 1,
              marginBottom: 10,
              paddingLeft: 10,
              borderRadius: 5,
              backgroundColor: 'white',
            }}
            placeholder="Enter your name"
            value={inputName}
            onChangeText={setInputName}
          />
        )}

        {showInput && (
          <TouchableOpacity
            onPress={handleSetName}
            style={{
              backgroundColor: '#28a745',
              padding: 10,
              borderRadius: 5,
            }}
          >
            <Text style={{ color: 'white' }}>Save</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

export default App;
