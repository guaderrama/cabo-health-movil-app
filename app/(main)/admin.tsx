// app/(main)/admin.tsx
// Hidden Admin Panel - Admin Only
// Access: Settings → Tap 5x on version → PIN

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  ActionSheetIOS,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../hooks';
import { CATEGORIES, AVAILABLE_CATEGORIES, getCategoryConfig, layout } from '../../constants';
import { WebApp } from '../../types';
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  query,
  orderBy,
} from 'firebase/firestore';
import { db } from '../../services/firebase';

// PIN de acceso (cambiar por uno seguro)
const ADMIN_PIN = '1234';

interface CardFormData {
  name: string;
  url: string;
  description: string;
  category: string;
  order: string;
  isActive: boolean;
  isNew: boolean;
}

const emptyForm: CardFormData = {
  name: '',
  url: '',
  description: '',
  category: 'salud',
  order: '1',
  isActive: true,
  isNew: false,
};

export default function AdminScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  // Estados
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [cards, setCards] = useState<WebApp[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingCard, setEditingCard] = useState<WebApp | null>(null);
  const [formData, setFormData] = useState<CardFormData>(emptyForm);

  // Cargar cards
  const loadCards = useCallback(async () => {
    setIsLoading(true);
    try {
      const q = query(collection(db, 'cabohealth_apps'), orderBy('order', 'asc'));
      const snapshot = await getDocs(q);
      const loadedCards: WebApp[] = [];
      snapshot.forEach((doc) => {
        loadedCards.push({ id: doc.id, ...doc.data() } as WebApp);
      });
      setCards(loadedCards);
    } catch (error) {
      console.error('Error loading cards:', error);
      Alert.alert('Error', 'Could not load cards');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadCards();
    }
  }, [isAuthenticated, loadCards]);

  // Verify PIN
  const handlePinSubmit = () => {
    if (pinInput === ADMIN_PIN) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setIsAuthenticated(true);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Incorrect PIN');
      setPinInput('');
    }
  };

  // Close form and reset all state
  const handleCloseForm = useCallback(() => {
    setShowForm(false);
    // Reset state after modal animation completes
    setTimeout(() => {
      setEditingCard(null);
      setFormData(emptyForm);
    }, 100);
  }, []);

  // Show category picker using ActionSheet (works reliably on iOS)
  const showCategoryPicker = useCallback(() => {
    const categoryLabels = AVAILABLE_CATEGORIES.map(cat => getCategoryConfig(cat).labelEn);

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', ...categoryLabels],
          cancelButtonIndex: 0,
          title: 'Select Category',
        },
        (buttonIndex) => {
          if (buttonIndex > 0) {
            const selectedCategory = AVAILABLE_CATEGORIES[buttonIndex - 1];
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setFormData(prev => ({ ...prev, category: selectedCategory }));
          }
        }
      );
    } else {
      // Android fallback using Alert
      Alert.alert(
        'Select Category',
        undefined,
        [
          { text: 'Cancel', style: 'cancel' },
          ...AVAILABLE_CATEGORIES.slice(0, 10).map(cat => ({
            text: getCategoryConfig(cat).labelEn,
            onPress: () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setFormData(prev => ({ ...prev, category: cat }));
            },
          })),
        ]
      );
    }
  }, []);

  // Open form for new card
  const handleAddCard = () => {
    setEditingCard(null);
    setFormData(emptyForm);
    setShowForm(true);
  };

  // Open form for editing
  const handleEditCard = (card: WebApp) => {
    setEditingCard(card);
    setFormData({
      name: card.name,
      url: card.url,
      description: card.description,
      category: card.category || 'otro',
      order: String(card.order),
      isActive: card.isActive,
      isNew: card.isNew || false,
    });
    setShowForm(true);
  };

  // Save card (create or update)
  const handleSaveCard = async () => {
    // Validation
    if (!formData.name.trim() || !formData.url.trim()) {
      Alert.alert('Error', 'Name and URL are required');
      return;
    }

    setIsLoading(true);
    try {
      const cardData = {
        name: formData.name.trim(),
        url: formData.url.trim(),
        description: formData.description.trim(),
        category: formData.category,
        order: parseInt(formData.order) || 1,
        isActive: formData.isActive,
        isNew: formData.isNew,
        updatedAt: serverTimestamp(),
      };

      const isEditing = !!editingCard;

      if (isEditing) {
        // Update
        await updateDoc(doc(db, 'cabohealth_apps', editingCard.id), cardData);
      } else {
        // Create
        await addDoc(collection(db, 'cabohealth_apps'), {
          ...cardData,
          createdAt: serverTimestamp(),
        });
      }

      // Close modal first
      setShowForm(false);

      // Refresh cards and reset state after modal closes
      setTimeout(() => {
        setEditingCard(null);
        setFormData(emptyForm);
        loadCards();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Success', isEditing ? 'Card updated' : 'Card created');
      }, 200);
    } catch (error) {
      console.error('Error saving card:', error);
      Alert.alert('Error', 'Could not save card');
    } finally {
      setIsLoading(false);
    }
  };

  // Delete card
  const handleDeleteCard = (card: WebApp) => {
    Alert.alert(
      'Delete Card',
      `Are you sure you want to delete "${card.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsLoading(true);
            try {
              await deleteDoc(doc(db, 'cabohealth_apps', card.id));
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              loadCards();
            } catch (error) {
              console.error('Error deleting card:', error);
              Alert.alert('Error', 'Could not delete');
            } finally {
              setIsLoading(false);
            }
          },
        },
      ]
    );
  };

  // Toggle active/inactive
  const handleToggleActive = async (card: WebApp) => {
    try {
      await updateDoc(doc(db, 'cabohealth_apps', card.id), {
        isActive: !card.isActive,
        updatedAt: serverTimestamp(),
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      loadCards();
    } catch (error) {
      console.error('Error toggling active:', error);
    }
  };

  // PIN Screen
  if (!isAuthenticated) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.pinContainer}>
          <Ionicons name="lock-closed" size={64} color={colors.primary} />
          <Text style={[styles.pinTitle, { color: colors.text }]}>Admin Panel</Text>
          <Text style={[styles.pinSubtitle, { color: colors.textSecondary }]}>
            Enter access PIN
          </Text>
          <TextInput
            style={[styles.pinInput, {
              backgroundColor: colors.cardBackground,
              color: colors.text,
              borderColor: colors.border,
            }]}
            value={pinInput}
            onChangeText={setPinInput}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
            placeholder="••••"
            placeholderTextColor={colors.textTertiary}
          />
          <TouchableOpacity
            style={[styles.pinButton, { backgroundColor: colors.primary }]}
            onPress={handlePinSubmit}
          >
            <Text style={styles.pinButtonText}>Access</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.replace('/(main)/settings')}
          >
            <Text style={[styles.backButtonText, { color: colors.textSecondary }]}>
              Back
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Admin Screen
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.replace('/(main)/settings')} style={styles.headerBack}>
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Admin Panel</Text>
        <TouchableOpacity onPress={handleAddCard} style={styles.headerAdd}>
          <Ionicons name="add-circle" size={28} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Card List */}
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          CARDS ({cards.length})
        </Text>

        {cards.map((card) => {
          const catConfig = getCategoryConfig(card.category);
          return (
            <View
              key={card.id}
              style={[styles.cardItem, {
                backgroundColor: colors.cardBackground,
                borderColor: colors.border,
                opacity: card.isActive ? 1 : 0.5,
              }]}
            >
              <View style={[styles.cardIcon, { backgroundColor: catConfig.color }]}>
                <Ionicons name={catConfig.icon} size={24} color={colors.primary} />
              </View>
              <View style={styles.cardInfo}>
                <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>
                  {card.name}
                </Text>
                <Text style={[styles.cardCategory, { color: colors.textSecondary }]}>
                  {catConfig.labelEn} • Order: {card.order}
                </Text>
              </View>
              <View style={styles.cardActions}>
                <TouchableOpacity
                  onPress={() => handleToggleActive(card)}
                  style={styles.actionButton}
                >
                  <Ionicons
                    name={card.isActive ? 'eye' : 'eye-off'}
                    size={20}
                    color={card.isActive ? colors.success : colors.textTertiary}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleEditCard(card)}
                  style={styles.actionButton}
                >
                  <Ionicons name="pencil" size={20} color={colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDeleteCard(card)}
                  style={styles.actionButton}
                >
                  <Ionicons name="trash" size={20} color={colors.error} />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Form Modal */}
      <Modal visible={showForm} animationType="slide" transparent onRequestClose={handleCloseForm}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalDismiss}
            activeOpacity={1}
            onPress={handleCloseForm}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
            style={styles.keyboardAvoid}
          >
            <View style={[styles.modalContent, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  {editingCard ? 'Edit Card' : 'New Card'}
                </Text>
                <TouchableOpacity onPress={handleCloseForm}>
                  <Ionicons name="close" size={24} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={true}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.formScrollContent}
                nestedScrollEnabled={true}
              >
              {/* Name */}
              <Text style={[styles.label, { color: colors.textSecondary }]}>Name *</Text>
              <TextInput
                style={[styles.input, {
                  backgroundColor: colors.background,
                  color: colors.text,
                  borderColor: colors.border,
                }]}
                value={formData.name}
                onChangeText={(text) => setFormData({ ...formData, name: text })}
                placeholder="App name"
                placeholderTextColor={colors.textTertiary}
              />

              {/* URL */}
              <Text style={[styles.label, { color: colors.textSecondary }]}>URL *</Text>
              <TextInput
                style={[styles.input, {
                  backgroundColor: colors.background,
                  color: colors.text,
                  borderColor: colors.border,
                }]}
                value={formData.url}
                onChangeText={(text) => setFormData({ ...formData, url: text })}
                placeholder="https://example.com"
                placeholderTextColor={colors.textTertiary}
                keyboardType="url"
                autoCapitalize="none"
              />

              {/* Description */}
              <Text style={[styles.label, { color: colors.textSecondary }]}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea, {
                  backgroundColor: colors.background,
                  color: colors.text,
                  borderColor: colors.border,
                }]}
                value={formData.description}
                onChangeText={(text) => setFormData({ ...formData, description: text })}
                placeholder="Short description"
                placeholderTextColor={colors.textTertiary}
                multiline
                numberOfLines={3}
              />

              {/* Category */}
              <Text style={[styles.label, { color: colors.textSecondary }]}>Category</Text>
              <TouchableOpacity
                style={[styles.picker, {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                }]}
                onPress={showCategoryPicker}
              >
                <View style={styles.pickerContent}>
                  <Ionicons
                    name={getCategoryConfig(formData.category).icon}
                    size={20}
                    color={colors.primary}
                  />
                  <Text style={[styles.pickerText, { color: colors.text }]}>
                    {getCategoryConfig(formData.category).labelEn}
                  </Text>
                </View>
                <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
              </TouchableOpacity>

              {/* Order */}
              <Text style={[styles.label, { color: colors.textSecondary }]}>Order</Text>
              <TextInput
                style={[styles.input, {
                  backgroundColor: colors.background,
                  color: colors.text,
                  borderColor: colors.border,
                }]}
                value={formData.order}
                onChangeText={(text) => setFormData({ ...formData, order: text })}
                placeholder="1"
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
              />

              {/* Switches */}
              <View style={styles.switchRow}>
                <Text style={[styles.switchLabel, { color: colors.text }]}>Active</Text>
                <TouchableOpacity
                  onPress={() => setFormData({ ...formData, isActive: !formData.isActive })}
                  style={[styles.switch, {
                    backgroundColor: formData.isActive ? colors.primary : colors.border
                  }]}
                >
                  <View style={[styles.switchThumb, {
                    transform: [{ translateX: formData.isActive ? 20 : 0 }]
                  }]} />
                </TouchableOpacity>
              </View>

              <View style={styles.switchRow}>
                <Text style={[styles.switchLabel, { color: colors.text }]}>Badge "New"</Text>
                <TouchableOpacity
                  onPress={() => setFormData({ ...formData, isNew: !formData.isNew })}
                  style={[styles.switch, {
                    backgroundColor: formData.isNew ? colors.primary : colors.border
                  }]}
                >
                  <View style={[styles.switchThumb, {
                    transform: [{ translateX: formData.isNew ? 20 : 0 }]
                  }]} />
                </TouchableOpacity>
              </View>

              {/* Save Button */}
              <TouchableOpacity
                style={[styles.saveButton, { backgroundColor: colors.primary }]}
                onPress={handleSaveCard}
                disabled={isLoading}
              >
                <Text style={styles.saveButtonText}>
                  {isLoading ? 'Saving...' : 'Save'}
                </Text>
              </TouchableOpacity>

              {/* Extra space for keyboard */}
              <View style={{ height: 50 }} />
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // PIN Screen
  pinContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  pinTitle: {
    fontSize: 28,
    fontWeight: '700',
    marginTop: 24,
  },
  pinSubtitle: {
    fontSize: 16,
    marginTop: 8,
    marginBottom: 32,
  },
  pinInput: {
    width: 160,
    height: 56,
    borderRadius: 12,
    borderWidth: 2,
    fontSize: 24,
    textAlign: 'center',
    letterSpacing: 8,
  },
  pinButton: {
    marginTop: 24,
    paddingHorizontal: 48,
    paddingVertical: 14,
    borderRadius: 12,
  },
  pinButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    marginTop: 16,
    padding: 12,
  },
  backButtonText: {
    fontSize: 16,
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerBack: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerAdd: {
    padding: 4,
  },
  // List
  scrollView: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 12,
  },
  cardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardInfo: {
    flex: 1,
    marginLeft: 12,
  },
  cardName: {
    fontSize: 16,
    fontWeight: '600',
  },
  cardCategory: {
    fontSize: 12,
    marginTop: 2,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 4,
  },
  actionButton: {
    padding: 8,
  },
  // Modal Form
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalDismiss: {
    flex: 1,
  },
  keyboardAvoid: {
    width: '100%',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: Dimensions.get('window').height * 0.75,
  },
  formScrollContent: {
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
  },
  pickerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pickerText: {
    fontSize: 16,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  switchLabel: {
    fontSize: 16,
  },
  switch: {
    width: 50,
    height: 30,
    borderRadius: 15,
    padding: 2,
  },
  switchThumb: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
  },
  saveButton: {
    marginTop: 24,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
