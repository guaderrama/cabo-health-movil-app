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
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../hooks';
import { CATEGORIES, AVAILABLE_CATEGORIES, getCategoryConfig, layout } from '../../constants';
import { WebApp, AccessCode } from '../../types';
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
  Timestamp,
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { config } from '../../constants';

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

// Access Code form
interface CodeFormData {
  code: string;
  clientName: string;
  notes: string;
  isActive: boolean;
}

const emptyCodeForm: CodeFormData = {
  code: '',
  clientName: '',
  notes: '',
  isActive: true,
};

// Generate random code
const generateCode = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'CABO-';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

export default function AdminScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  // Estados
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [activeTab, setActiveTab] = useState<'cards' | 'codes'>('cards');

  // Cards state
  const [cards, setCards] = useState<WebApp[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingCard, setEditingCard] = useState<WebApp | null>(null);
  const [formData, setFormData] = useState<CardFormData>(emptyForm);

  // Access Codes state
  const [accessCodes, setAccessCodes] = useState<AccessCode[]>([]);
  const [showCodeForm, setShowCodeForm] = useState(false);
  const [editingCode, setEditingCode] = useState<AccessCode | null>(null);
  const [codeFormData, setCodeFormData] = useState<CodeFormData>(emptyCodeForm);

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

  // Load access codes
  const loadAccessCodes = useCallback(async () => {
    try {
      const q = query(collection(db, config.collections.accessCodes), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const loadedCodes: AccessCode[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        loadedCodes.push({
          id: docSnap.id,
          code: data.code,
          clientName: data.clientName,
          isActive: data.isActive,
          createdAt: data.createdAt?.toDate() || new Date(),
          expiresAt: data.expiresAt?.toDate(),
          lastUsedAt: data.lastUsedAt?.toDate(),
          notes: data.notes,
        } as AccessCode);
      });
      setAccessCodes(loadedCodes);
    } catch (error) {
      console.error('Error loading access codes:', error);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadCards();
      loadAccessCodes();
    }
  }, [isAuthenticated, loadCards, loadAccessCodes]);

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

  // ========== ACCESS CODE FUNCTIONS ==========

  // Add new code
  const handleAddCode = () => {
    setEditingCode(null);
    setCodeFormData({
      ...emptyCodeForm,
      code: generateCode(),
    });
    setShowCodeForm(true);
  };

  // Edit code
  const handleEditCode = (code: AccessCode) => {
    setEditingCode(code);
    setCodeFormData({
      code: code.code,
      clientName: code.clientName,
      notes: code.notes || '',
      isActive: code.isActive,
    });
    setShowCodeForm(true);
  };

  // Save code
  const handleSaveCode = async () => {
    if (!codeFormData.code.trim() || !codeFormData.clientName.trim()) {
      Alert.alert('Error', 'Code and Client Name are required');
      return;
    }

    setIsLoading(true);
    try {
      const codeData = {
        code: codeFormData.code.trim().toUpperCase(),
        clientName: codeFormData.clientName.trim(),
        notes: codeFormData.notes.trim(),
        isActive: codeFormData.isActive,
        updatedAt: serverTimestamp(),
      };

      if (editingCode) {
        await updateDoc(doc(db, config.collections.accessCodes, editingCode.id!), codeData);
      } else {
        await addDoc(collection(db, config.collections.accessCodes), {
          ...codeData,
          createdAt: serverTimestamp(),
        });
      }

      setShowCodeForm(false);
      setTimeout(() => {
        setEditingCode(null);
        setCodeFormData(emptyCodeForm);
        loadAccessCodes();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Success', editingCode ? 'Code updated' : 'Code created');
      }, 200);
    } catch (error) {
      console.error('Error saving code:', error);
      Alert.alert('Error', 'Could not save code');
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle code active
  const handleToggleCodeActive = async (code: AccessCode) => {
    try {
      await updateDoc(doc(db, config.collections.accessCodes, code.id!), {
        isActive: !code.isActive,
        updatedAt: serverTimestamp(),
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      loadAccessCodes();
    } catch (error) {
      console.error('Error toggling code:', error);
    }
  };

  // Delete code
  const handleDeleteCode = (code: AccessCode) => {
    Alert.alert(
      'Delete Code',
      `Are you sure you want to delete code for "${code.clientName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDoc(doc(db, config.collections.accessCodes, code.id!));
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              loadAccessCodes();
            } catch (error) {
              console.error('Error deleting code:', error);
              Alert.alert('Error', 'Could not delete');
            }
          },
        },
      ]
    );
  };

  // Copy code to clipboard
  const handleCopyCode = async (code: string) => {
    try {
      await Clipboard.setStringAsync(code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Copied!', `Code "${code}" copied to clipboard`, [{ text: 'OK' }]);
    } catch (error) {
      console.error('Error copying:', error);
      Alert.alert('Error', 'Could not copy to clipboard');
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
        <TouchableOpacity
          onPress={activeTab === 'cards' ? handleAddCard : handleAddCode}
          style={styles.headerAdd}
        >
          <Ionicons name="add-circle" size={28} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={[styles.tabContainer, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'cards' ? { borderBottomColor: colors.primary } : { borderBottomColor: 'transparent' },
          ]}
          onPress={() => setActiveTab('cards')}
        >
          <Ionicons
            name="apps"
            size={18}
            color={activeTab === 'cards' ? colors.primary : colors.textSecondary}
          />
          <Text style={[
            styles.tabText,
            { color: activeTab === 'cards' ? colors.primary : colors.textSecondary }
          ]}>
            Cards
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'codes' ? { borderBottomColor: colors.primary } : { borderBottomColor: 'transparent' },
          ]}
          onPress={() => setActiveTab('codes')}
        >
          <Ionicons
            name="key"
            size={18}
            color={activeTab === 'codes' ? colors.primary : colors.textSecondary}
          />
          <Text style={[
            styles.tabText,
            { color: activeTab === 'codes' ? colors.primary : colors.textSecondary }
          ]}>
            Access Codes
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content based on active tab */}
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {activeTab === 'cards' ? (
          <>
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
          </>
        ) : (
          <>
            {/* ACCESS CODES TAB */}
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              ACCESS CODES ({accessCodes.length})
            </Text>

            {accessCodes.length === 0 ? (
              <View style={[styles.emptyState, { backgroundColor: colors.cardBackground }]}>
                <Ionicons name="key-outline" size={48} color={colors.textTertiary} />
                <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>
                  No access codes yet
                </Text>
                <Text style={[styles.emptyStateSubtext, { color: colors.textTertiary }]}>
                  Tap + to create your first code
                </Text>
              </View>
            ) : (
              accessCodes.map((code) => (
                <View
                  key={code.id}
                  style={[styles.cardItem, {
                    backgroundColor: colors.cardBackground,
                    borderColor: colors.border,
                    opacity: code.isActive ? 1 : 0.5,
                  }]}
                >
                  <TouchableOpacity
                    style={[styles.cardIcon, { backgroundColor: code.isActive ? colors.success + '20' : colors.error + '20' }]}
                    onPress={() => handleCopyCode(code.code)}
                  >
                    <Ionicons
                      name="key"
                      size={24}
                      color={code.isActive ? colors.success : colors.error}
                    />
                  </TouchableOpacity>
                  <View style={styles.cardInfo}>
                    <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>
                      {code.clientName}
                    </Text>
                    <Text style={[styles.codeText, { color: colors.primary }]}>
                      {code.code}
                    </Text>
                    <Text style={[styles.cardCategory, { color: colors.textSecondary }]}>
                      {code.isActive ? 'Active' : 'Inactive'}
                      {code.lastUsedAt && ` • Last used: ${code.lastUsedAt.toLocaleDateString()}`}
                    </Text>
                  </View>
                  <View style={styles.cardActions}>
                    <TouchableOpacity
                      onPress={() => handleToggleCodeActive(code)}
                      style={styles.actionButton}
                    >
                      <Ionicons
                        name={code.isActive ? 'checkmark-circle' : 'close-circle'}
                        size={20}
                        color={code.isActive ? colors.success : colors.error}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleEditCode(code)}
                      style={styles.actionButton}
                    >
                      <Ionicons name="pencil" size={20} color={colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDeleteCode(code)}
                      style={styles.actionButton}
                    >
                      <Ionicons name="trash" size={20} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Card Form Modal */}
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

      {/* Access Code Form Modal */}
      <Modal
        visible={showCodeForm}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCodeForm(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalDismiss}
            activeOpacity={1}
            onPress={() => setShowCodeForm(false)}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
            style={styles.keyboardAvoid}
          >
            <View style={[styles.modalContent, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  {editingCode ? 'Edit Access Code' : 'New Access Code'}
                </Text>
                <TouchableOpacity onPress={() => setShowCodeForm(false)}>
                  <Ionicons name="close" size={24} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={true}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.formScrollContent}
              >
                {/* Code */}
                <Text style={[styles.label, { color: colors.textSecondary }]}>Access Code *</Text>
                <View style={styles.codeInputRow}>
                  <TextInput
                    style={[styles.input, styles.codeInput, {
                      backgroundColor: colors.background,
                      color: colors.text,
                      borderColor: colors.border,
                    }]}
                    value={codeFormData.code}
                    onChangeText={(text) => setCodeFormData({ ...codeFormData, code: text.toUpperCase() })}
                    placeholder="CABO-XXXXXXXX"
                    placeholderTextColor={colors.textTertiary}
                    autoCapitalize="characters"
                  />
                  <TouchableOpacity
                    style={[styles.generateButton, { backgroundColor: colors.primary }]}
                    onPress={() => setCodeFormData({ ...codeFormData, code: generateCode() })}
                  >
                    <Ionicons name="refresh" size={20} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>

                {/* Client Name */}
                <Text style={[styles.label, { color: colors.textSecondary }]}>Client Name *</Text>
                <TextInput
                  style={[styles.input, {
                    backgroundColor: colors.background,
                    color: colors.text,
                    borderColor: colors.border,
                  }]}
                  value={codeFormData.clientName}
                  onChangeText={(text) => setCodeFormData({ ...codeFormData, clientName: text })}
                  placeholder="Dr. García - Clínica Los Cabos"
                  placeholderTextColor={colors.textTertiary}
                />

                {/* Notes */}
                <Text style={[styles.label, { color: colors.textSecondary }]}>Notes</Text>
                <TextInput
                  style={[styles.input, styles.textArea, {
                    backgroundColor: colors.background,
                    color: colors.text,
                    borderColor: colors.border,
                  }]}
                  value={codeFormData.notes}
                  onChangeText={(text) => setCodeFormData({ ...codeFormData, notes: text })}
                  placeholder="Premium Plan, Annual subscription..."
                  placeholderTextColor={colors.textTertiary}
                  multiline
                  numberOfLines={2}
                />

                {/* Active Switch */}
                <View style={styles.switchRow}>
                  <Text style={[styles.switchLabel, { color: colors.text }]}>Active</Text>
                  <TouchableOpacity
                    onPress={() => setCodeFormData({ ...codeFormData, isActive: !codeFormData.isActive })}
                    style={[styles.switch, {
                      backgroundColor: codeFormData.isActive ? colors.success : colors.border
                    }]}
                  >
                    <View style={[styles.switchThumb, {
                      transform: [{ translateX: codeFormData.isActive ? 20 : 0 }]
                    }]} />
                  </TouchableOpacity>
                </View>

                {/* Save Button */}
                <TouchableOpacity
                  style={[styles.saveButton, { backgroundColor: colors.primary }]}
                  onPress={handleSaveCode}
                  disabled={isLoading}
                >
                  <Text style={styles.saveButtonText}>
                    {isLoading ? 'Saving...' : 'Save Code'}
                  </Text>
                </TouchableOpacity>

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
  // Tabs
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 6,
    borderBottomWidth: 2,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
  },
  // Access Codes
  codeText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 2,
  },
  codeInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  codeInput: {
    flex: 1,
  },
  generateButton: {
    width: 48,
    height: 48,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    borderRadius: 12,
    marginTop: 20,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  emptyStateSubtext: {
    fontSize: 14,
    marginTop: 8,
  },
});
